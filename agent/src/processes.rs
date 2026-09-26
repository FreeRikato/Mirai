use std::cmp::Ordering;
use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::kill::{base, is_protected};
use crate::schema::Process;

#[derive(Clone, Debug)]
pub struct RawProcess {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub user: String,
    pub cpu: f64,
    pub mem_bytes: u64,
    pub started: String,
}

pub struct Owner<'a> {
    pub user: &'a str,
    pub self_pid: u32,
}

pub fn round1(n: f64) -> f64 {
    (n * 10.0).round() / 10.0
}

pub fn by_cpu(a: &RawProcess, b: &RawProcess) -> Ordering {
    b.cpu.total_cmp(&a.cpu).then(b.mem_bytes.cmp(&a.mem_bytes))
}

fn by_mem(a: &RawProcess, b: &RawProcess) -> Ordering {
    b.mem_bytes.cmp(&a.mem_bytes).then(b.cpu.total_cmp(&a.cpu))
}

pub fn can_kill(p: &RawProcess, owner: &Owner) -> bool {
    p.pid > 1 && p.pid != owner.self_pid && p.user == owner.user && !is_protected(&p.name)
}

pub fn pick_processes(list: &[RawProcess], per_rank: usize, owner: &Owner) -> Vec<Process> {
    let mut sorted: Vec<&RawProcess> = list.iter().collect();
    let mut picked: HashMap<u32, &RawProcess> = HashMap::new();
    sorted.sort_by(|a, b| by_cpu(a, b));
    picked.extend(sorted.iter().take(per_rank).map(|p| (p.pid, *p)));
    sorted.sort_by(|a, b| by_mem(a, b));
    picked.extend(sorted.iter().take(per_rank).map(|p| (p.pid, *p)));
    let mut out: Vec<&RawProcess> = picked.into_values().collect();
    out.sort_by(|a, b| by_cpu(a, b));
    out.into_iter()
        .map(|p| Process {
            pid: p.pid,
            name: p.name.clone(),
            command: p.command.clone(),
            user: p.user.clone(),
            cpu: round1(p.cpu),
            mem_bytes: p.mem_bytes,
            started: p.started.clone(),
            killable: can_kill(p, owner),
        })
        .collect()
}

pub fn command_line(exe: &str, args: &str) -> String {
    match args.strip_prefix(exe) {
        Some(rest) => format!("{}{rest}", base(exe)),
        None => args.to_string(),
    }
}

pub fn parse_ps(table: &str, args: &str) -> Vec<RawProcess> {
    let args: HashMap<u32, &str> = args.lines().filter_map(|l| l.trim_start().split_once(' ').and_then(|(pid, a)| Some((pid.parse().ok()?, a.trim_start())))).collect();
    table
        .lines()
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let pid: u32 = cols.next()?.parse().ok()?;
            let cpu: f64 = cols.next()?.parse().ok()?;
            let rss_kb: u64 = cols.next()?.parse().ok()?;
            let user = cols.next()?.to_string();
            let lstart = cols.by_ref().take(5).collect::<Vec<_>>().join(" ");
            let exe = cols.collect::<Vec<_>>().join(" ");
            if exe.is_empty() {
                return None;
            }
            let started = NaiveDateTime::parse_from_str(&lstart, "%a %b %e %H:%M:%S %Y").map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default();
            Some(RawProcess {
                pid,
                name: base(&exe).to_string(),
                command: args.get(&pid).map_or_else(|| base(&exe).to_string(), |a| command_line(&exe, a)),
                user,
                cpu,
                mem_bytes: rss_kb * 1024,
                started,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, cpu: f64, mem_mb: u64) -> RawProcess {
        RawProcess { pid, name: format!("p{pid}"), command: format!("/bin/p{pid}"), user: "me".into(), cpu, mem_bytes: mem_mb << 20, started: "2026-09-24 10:00:00".into() }
    }

    const OWNER: Owner<'static> = Owner { user: "me", self_pid: 500 };

    #[test]
    fn ps_rows_keep_names_with_spaces_and_other_users_processes() {
        let table = "    1   0.1  11680 root             Tue Sep 15 22:25:29 2026     /sbin/launchd\n23193  10.4 248348 dev              Thu Sep 24 11:18:14 2026     /Applications/T3.app/Contents/MacOS/T3 Code (Nightly) Helper (Renderer)\n";
        let args = "    1 /sbin/launchd\n23193 /Applications/T3.app/Contents/MacOS/T3 Code (Nightly) Helper (Renderer) --type=renderer\n";
        let got = parse_ps(table, args);
        assert_eq!(got.len(), 2);
        assert_eq!((got[0].pid, got[0].name.as_str(), got[0].user.as_str(), got[0].mem_bytes, got[0].started.as_str()), (1, "launchd", "root", 11680 * 1024, "2026-09-15 22:25:29"));
        assert_eq!((got[1].name.as_str(), got[1].command.as_str(), got[1].cpu), ("T3 Code (Nightly) Helper (Renderer)", "T3 Code (Nightly) Helper (Renderer) --type=renderer", 10.4));
    }

    #[test]
    fn an_idle_process_that_holds_the_most_memory_is_kept_even_when_the_cpu_ranking_would_drop_it() {
        let mut list: Vec<RawProcess> = (0..5).map(|i| proc(10 + i, 50.0 - f64::from(i), 10)).collect();
        list.push(RawProcess { name: "dockerd".into(), ..proc(99, 0.0, 1000) });
        let picked: Vec<u32> = pick_processes(&list, 3, &OWNER).iter().map(|p| p.pid).collect();
        assert!(picked.contains(&99));
        assert_eq!(picked[..3], [10, 11, 12]);
    }

    #[test]
    fn cpu_ties_are_broken_by_memory_so_the_order_is_stable() {
        let picked: Vec<u32> = pick_processes(&[proc(1, 0.0, 10), proc(2, 0.0, 300), proc(3, 0.0, 50)], 3, &OWNER).iter().map(|p| p.pid).collect();
        assert_eq!(picked, [2, 3, 1]);
    }

    #[test]
    fn only_processes_the_agent_could_actually_signal_are_marked_killable() {
        let list = [
            proc(2000, 1.0, 1),
            RawProcess { user: "root".into(), ..proc(2001, 1.0, 1) },
            RawProcess { name: "tailscaled".into(), ..proc(2002, 1.0, 1) },
            RawProcess { name: "mirai-agent".into(), ..proc(500, 1.0, 1) },
        ];
        let killable: HashMap<u32, bool> = pick_processes(&list, 10, &OWNER).iter().map(|p| (p.pid, p.killable)).collect();
        assert_eq!(killable, HashMap::from([(2000, true), (2001, false), (2002, false), (500, false)]));
    }
}
