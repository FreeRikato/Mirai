use serde::Serialize;
use serde_json::{Value, json};

use crate::schema::{KillRequest, KillSignal};

#[derive(Debug, PartialEq)]
pub struct Outcome {
    pub status: u16,
    pub body: Value,
}

#[derive(Debug)]
pub enum SendError {
    NotPermitted,
    NoSuchProcess,
    Other(String),
}

pub struct Running<'a> {
    pub pid: u32,
    pub name: &'a str,
}

const PROTECTED: [&str; 9] = ["init", "systemd", "launchd", "kernel_task", "WindowServer", "loginwindow", "sshd", "tailscaled", "mirai-agent"];

pub fn base(s: &str) -> &str {
    s.rsplit('/').next().unwrap_or(s)
}

pub fn is_protected(name: &str) -> bool {
    let first = base(name.trim()).split(' ').next().unwrap_or("");
    PROTECTED.contains(&first)
}

pub fn same_process(shown: &str, current: &str) -> bool {
    let a = base(shown.trim());
    let b = base(current.trim());
    !a.is_empty() && !b.is_empty() && (a.starts_with(b) || b.starts_with(a))
}

fn error(status: u16, message: String) -> Outcome {
    Outcome { status, body: json!({ "error": message }) }
}

#[derive(Serialize)]
struct Signalled<'a> {
    pid: u32,
    name: &'a str,
    signal: KillSignal,
}

pub fn kill_process(req: &KillRequest, running: &[Running], self_pid: u32, send: impl FnOnce(u32, KillSignal) -> Result<(), SendError>) -> Outcome {
    let pid = match u32::try_from(req.pid) {
        Ok(pid) if pid > 1 && pid != self_pid => pid,
        _ => return error(400, format!("refusing to signal pid {}", req.pid)),
    };
    let Some(current) = running.iter().find(|p| p.pid == pid) else {
        return error(404, format!("pid {pid} is no longer running"));
    };
    if !same_process(&req.name, current.name) {
        return error(409, format!("pid {pid} is now {}, not {}", current.name, req.name));
    }
    if is_protected(current.name) {
        return error(403, format!("{} is protected; stopping it could cut this machine off the tailnet", current.name));
    }
    match send(pid, req.signal) {
        Ok(()) => Outcome { status: 200, body: json!(Signalled { pid, name: current.name, signal: req.signal }) },
        Err(SendError::NotPermitted) => error(403, format!("not permitted to signal {}; it belongs to another user", current.name)),
        Err(SendError::NoSuchProcess) => error(404, format!("pid {pid} exited before it could be signalled")),
        Err(SendError::Other(message)) => error(500, message),
    }
}

pub fn send_signal(pid: u32, signal: KillSignal) -> Result<(), SendError> {
    use rustix::io::Errno;
    use rustix::process::{Pid, Signal, kill_process};
    let target = i32::try_from(pid).ok().and_then(Pid::from_raw).ok_or(SendError::NoSuchProcess)?;
    let sig = match signal {
        KillSignal::Term => Signal::TERM,
        KillSignal::Kill => Signal::KILL,
    };
    kill_process(target, sig).map_err(|e| match e {
        Errno::PERM => SendError::NotPermitted,
        Errno::SRCH => SendError::NoSuchProcess,
        other => SendError::Other(other.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNNING: [Running<'static>; 3] = [Running { pid: 9589, name: "cloudflared" }, Running { pid: 92823, name: ".venv/bin/python" }, Running { pid: 4242, name: "root-daemon" }];

    fn req(pid: i64, name: &str) -> KillRequest {
        KillRequest { pid, name: name.into(), signal: KillSignal::Term }
    }

    fn must_not_signal(_: u32, _: KillSignal) -> Result<(), SendError> {
        panic!("must not signal")
    }

    #[test]
    fn names_from_the_ports_list_and_the_process_list_are_recognised_as_the_same_process() {
        assert!(same_process("cloudflared tunnel run", "cloudflared"));
        assert!(same_process("python", ".venv/bin/python"));
        assert!(same_process("gnome-shell-cal", "gnome-shell-calendar-server"));
        assert!(!same_process("postgres", "node"));
        assert!(!same_process("", "node"));
    }

    #[test]
    fn signals_the_process_when_the_pid_still_belongs_to_what_the_user_confirmed() {
        let mut sent = vec![];
        let r = KillRequest { pid: 9589, name: "cloudflared tunnel run".into(), signal: KillSignal::Kill };
        let out = kill_process(&r, &RUNNING, 1000, |p, s| {
            sent.push((p, s));
            Ok(())
        });
        assert_eq!(out, Outcome { status: 200, body: json!({ "pid": 9589, "name": "cloudflared", "signal": "SIGKILL" }) });
        assert_eq!(sent, vec![(9589, KillSignal::Kill)]);
    }

    #[test]
    fn refuses_init_the_agent_itself_gone_pids_and_reused_pids_without_signalling() {
        assert_eq!(kill_process(&req(1, "launchd"), &RUNNING, 1000, must_not_signal).status, 400);
        let with_self = [Running { pid: 1000, name: "mirai-agent" }];
        assert_eq!(kill_process(&req(1000, "mirai-agent"), &with_self, 1000, must_not_signal).status, 400);
        assert_eq!(kill_process(&req(31337, "node"), &RUNNING, 1000, must_not_signal).status, 404);
        assert_eq!(kill_process(&req(9589, "postgres"), &RUNNING, 1000, must_not_signal), error(409, "pid 9589 is now cloudflared, not postgres".into()));
    }

    #[test]
    fn a_permission_error_becomes_a_403_that_names_the_process() {
        let out = kill_process(&req(4242, "root-daemon"), &RUNNING, 1000, |_, _| Err(SendError::NotPermitted));
        assert_eq!(out, error(403, "not permitted to signal root-daemon; it belongs to another user".into()));
        assert_eq!(kill_process(&req(4242, "root-daemon"), &RUNNING, 1000, |_, _| Ok(())).status, 200);
    }

    #[test]
    fn refuses_processes_whose_loss_would_cut_the_machine_off_even_when_the_name_matches() {
        let running = [Running { pid: 77, name: "tailscaled" }];
        assert_eq!(kill_process(&req(77, "tailscaled"), &running, 1000, must_not_signal).status, 403);
    }
}
