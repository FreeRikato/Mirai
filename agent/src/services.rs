use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;

use crate::docker;
use crate::schema::{Service, ServiceKind, ServiceState};

pub fn since_unix(value: Option<&str>, now_ms: i64) -> Option<String> {
    let sec: f64 = value?.trim_start_matches('@').parse().ok()?;
    if !sec.is_finite() || sec <= 0.0 {
        return None;
    }
    let s = (now_ms as f64 / 1000.0 - sec).max(0.0);
    let (n, unit) = if s < 3600.0 {
        (s / 60.0, "minute")
    } else if s < 86400.0 {
        (s / 3600.0, "hour")
    } else if s < 14.0 * 86400.0 {
        (s / 86400.0, "day")
    } else {
        (s / (7.0 * 86400.0), "week")
    };
    let k = n.floor().max(1.0) as u64;
    Some(format!("{k} {unit}{}", if k == 1 { "" } else { "s" }))
}

fn blocks(text: &str) -> Vec<HashMap<&str, &str>> {
    let mut out = vec![HashMap::new()];
    for line in text.lines() {
        if line.trim().is_empty() {
            out.push(HashMap::new());
        } else if let Some((k, v)) = line.split_once('=')
            && let Some(block) = out.last_mut()
        {
            block.insert(k, v);
        }
    }
    out
}

pub fn parse_systemd_show(text: &str, user_unit_dir: &str, now_ms: i64) -> Vec<Service> {
    let mut out = vec![];
    for f in blocks(text) {
        let (Some(id), Some(fragment)) = (f.get("Id"), f.get("FragmentPath")) else { continue };
        if !fragment.starts_with(user_unit_dir) {
            continue;
        }
        let active = f.get("ActiveState").copied().unwrap_or("");
        let sub = f.get("SubState").copied().unwrap_or("");
        let state = if active == "failed" {
            ServiceState::Failed
        } else if sub == "auto-restart" || active == "activating" {
            ServiceState::Restarting
        } else if active == "active" {
            ServiceState::Running
        } else {
            ServiceState::Stopped
        };
        out.push(Service {
            name: id.trim_end_matches(".service").to_string(),
            kind: ServiceKind::Systemd,
            state,
            detail: if state == ServiceState::Failed { format!("failed, {}", f.get("Result").copied().unwrap_or("error")) } else { sub.to_string() },
            since: since_unix(f.get("ActiveEnterTimestamp").copied().filter(|v| !v.is_empty()), now_ms),
            restarts: f.get("NRestarts").and_then(|n| n.parse().ok()),
            ports: String::new(),
        });
    }
    out
}

#[derive(Deserialize)]
struct FailedUnit {
    unit: String,
}

pub fn parse_systemd_failed(json: &str) -> Vec<Service> {
    let rows: Vec<FailedUnit> = serde_json::from_str(json).unwrap_or_default();
    rows.into_iter()
        .map(|r| Service {
            name: r.unit.trim_end_matches(".service").to_string(),
            kind: ServiceKind::Systemd,
            state: ServiceState::Failed,
            detail: "failed".into(),
            since: None,
            restarts: None,
            ports: String::new(),
        })
        .collect()
}

fn since_docker(status: &str) -> Option<String> {
    let s = status.strip_prefix("Up ").unwrap_or(status);
    let s = match s.find(" (") {
        Some(i) if s.ends_with(')') => &s[..i],
        _ => s,
    };
    (!s.is_empty()).then(|| s.to_string())
}

pub fn docker_services(running: Vec<docker::Running>) -> Vec<Service> {
    running
        .into_iter()
        .map(|r| {
            let name = match (r.labels.get("com.docker.compose.project"), r.labels.get("com.docker.compose.service")) {
                (Some(project), Some(svc)) => format!("{project}/{svc}"),
                _ => r.name,
            };
            Service {
                name,
                kind: ServiceKind::Docker,
                state: if r.restarting { ServiceState::Restarting } else { ServiceState::Running },
                since: since_docker(&r.status),
                detail: r.status,
                restarts: None,
                ports: r.ports.iter().map(|p| format!(":{p}")).collect::<Vec<_>>().join(" "),
            }
        })
        .collect()
}

pub fn parse_launchctl(text: &str, mine: &HashSet<String>) -> Vec<Service> {
    let mut out = vec![];
    for line in text.lines().skip(1) {
        let mut cols = line.split('\t');
        let (Some(pid), Some(status), Some(label)) = (cols.next(), cols.next(), cols.next()) else { continue };
        if !mine.contains(label) {
            continue;
        }
        let running = pid != "-";
        let code: i64 = status.parse().unwrap_or(0);
        out.push(Service {
            name: label.to_string(),
            kind: ServiceKind::Launchd,
            state: if running {
                ServiceState::Running
            } else if code != 0 {
                ServiceState::Failed
            } else {
                ServiceState::Stopped
            },
            detail: if running {
                format!("pid {pid}")
            } else if code != 0 {
                format!("exit {code}")
            } else {
                "idle".into()
            },
            since: None,
            restarts: None,
            ports: String::new(),
        });
    }
    out
}

pub fn run(cmd: &str, args: &[&str]) -> String {
    output_of(Command::new(cmd).args(args))
}

pub fn run_c(cmd: &str, args: &[&str]) -> String {
    output_of(Command::new(cmd).args(args).env("LC_ALL", "C"))
}

fn output_of(cmd: &mut Command) -> String {
    cmd
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

fn linux_services(home: &Path, now_ms: i64) -> Vec<Service> {
    let user_dir = format!("{}/.config/systemd/user/", home.display());
    let show = run("systemctl", &["--user", "show", "--timestamp=unix", "--type=service", "-p", "Id,FragmentPath,ActiveState,SubState,NRestarts,ActiveEnterTimestamp,Result", "*"]);
    let failed = run("systemctl", &["--failed", "--output=json"]);
    let mut out = parse_systemd_show(&show, &user_dir, now_ms);
    if !failed.trim().is_empty() {
        out.extend(parse_systemd_failed(&failed));
    }
    out
}

fn mac_services(home: &Path) -> Vec<Service> {
    let mine: HashSet<String> = std::fs::read_dir(home.join("Library/LaunchAgents"))
        .map(|dir| dir.filter_map(Result::ok).filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".plist")).map(str::to_string)).collect())
        .unwrap_or_default();
    parse_launchctl(&run("launchctl", &["list"]), &mine)
}

pub fn collect(home: &Path, docker_socket: &Path, now_ms: i64) -> Vec<Service> {
    let mut all = if cfg!(target_os = "macos") { mac_services(home) } else { linux_services(home, now_ms) };
    all.extend(docker_services(docker::running(docker_socket)));
    all.sort_by(|a, b| a.state.cmp(&b.state).then_with(|| a.name.cmp(&b.name)));
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn systemd_keeps_only_units_from_the_users_unit_dir_with_failed_and_auto_restart_mapped() {
        let text = [
            "Id=t3code.service\nFragmentPath=/home/o/.config/systemd/user/t3code.service\nActiveState=active\nSubState=running\nNRestarts=0\nActiveEnterTimestamp=@1000000\nResult=success",
            "Id=hermes-gateway.service\nFragmentPath=/home/o/.config/systemd/user/hermes-gateway.service\nActiveState=failed\nSubState=failed\nNRestarts=5\nActiveEnterTimestamp=\nResult=exit-code",
            "Id=flappy.service\nFragmentPath=/home/o/.config/systemd/user/flappy.service\nActiveState=activating\nSubState=auto-restart\nNRestarts=12\nActiveEnterTimestamp=\nResult=success",
            "Id=gnome-shell.service\nFragmentPath=/usr/lib/systemd/user/gnome-shell.service\nActiveState=active\nSubState=running",
        ]
        .join("\n\n");
        let got: Vec<(String, ServiceState, Option<u32>, Option<String>)> =
            parse_systemd_show(&text, "/home/o/.config/systemd/user/", (1_000_000 + 3 * 86400) * 1000).into_iter().map(|s| (s.name, s.state, s.restarts, s.since)).collect();
        assert_eq!(
            got,
            vec![
                ("t3code".into(), ServiceState::Running, Some(0), Some("3 days".into())),
                ("hermes-gateway".into(), ServiceState::Failed, Some(5), None),
                ("flappy".into(), ServiceState::Restarting, Some(12), None),
            ]
        );
    }

    #[test]
    fn docker_names_running_containers_by_compose_project_and_service_with_published_ports() {
        let list = r#"[{"Id":"aaa","Names":["/qa-graphql-engine-1"],"State":"running","Status":"Up 7 hours (healthy)","Labels":{"com.docker.compose.project":"qa","com.docker.compose.service":"graphql-engine"},"Ports":[{"IP":"0.0.0.0","PrivatePort":8080,"PublicPort":20182,"Type":"tcp"},{"IP":"::","PrivatePort":8080,"PublicPort":20182,"Type":"tcp"}]},
            {"Id":"bbb","Names":["/old"],"State":"exited","Status":"Exited (137)","Labels":{},"Ports":[]}]"#;
        assert_eq!(
            docker_services(docker::parse_running(list)),
            vec![Service {
                name: "qa/graphql-engine".into(),
                kind: ServiceKind::Docker,
                state: ServiceState::Running,
                detail: "Up 7 hours (healthy)".into(),
                since: Some("7 hours".into()),
                restarts: None,
                ports: ":20182".into(),
            }]
        );
    }

    #[test]
    fn launchd_keeps_only_the_users_own_agents_and_a_nonzero_exit_without_a_pid_is_failed() {
        let text = "PID\tStatus\tLabel\n4393\t0\tcom.github.syncthing.syncthing\n-\t1\tcom.rikato.review-index\n-\t0\tcom.apple.trustd\n";
        let mine = HashSet::from(["com.github.syncthing.syncthing".to_string(), "com.rikato.review-index".to_string()]);
        let got: Vec<(String, ServiceState)> = parse_launchctl(text, &mine).into_iter().map(|s| (s.name, s.state)).collect();
        assert_eq!(got, vec![("com.github.syncthing.syncthing".into(), ServiceState::Running), ("com.rikato.review-index".into(), ServiceState::Failed)]);
    }
}
