use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use walkdir::WalkDir;

use crate::{docker, ports, procnet};
use crate::schema::{Link, Listener, Projects, Worktree};
use crate::services::run;

const SKIP_DIRS: [&str; 8] = ["node_modules", "target", "dist", "build", ".venv", "venv", "vendor", ".cache"];

pub fn find_repos(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut walk = WalkDir::new(root).max_depth(max_depth).sort_by_file_name().into_iter();
    while let Some(next) = walk.next() {
        let Ok(entry) = next else { continue };
        if !entry.file_type().is_dir() {
            continue;
        }
        let name = entry.file_name().to_str().unwrap_or_default();
        if entry.depth() > 0 && (SKIP_DIRS.contains(&name) || name == ".git") {
            walk.skip_current_dir();
            continue;
        }
        if entry.path().join(".git").exists() {
            out.push(entry.path().to_path_buf());
            walk.skip_current_dir();
        }
    }
    out.sort();
    out
}

#[derive(Debug, PartialEq)]
pub struct ListedWorktree {
    pub path: String,
    pub branch: Option<String>,
}

pub fn repo_dir(first: &str) -> String {
    first.strip_suffix("/.bare").or_else(|| first.strip_suffix("/.git")).unwrap_or(first).to_string()
}

pub fn parse_worktree_list(text: &str) -> (Option<String>, Vec<ListedWorktree>) {
    let first = text.lines().next().and_then(|l| l.strip_prefix("worktree ")).map(repo_dir);
    let mut out = vec![];
    for block in text.split("\n\n") {
        let mut path = None;
        let mut branch = None;
        let mut gone = false;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line.starts_with("prunable") || line == "bare" {
                gone = true;
            }
        }
        if let (Some(path), false) = (path, gone) {
            out.push(ListedWorktree { path, branch });
        }
    }
    (first, out)
}

#[derive(Debug, PartialEq, Default)]
pub struct Status {
    pub dirty: u32,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

pub fn parse_status(text: &str) -> Status {
    let mut s = Status::default();
    for line in text.lines() {
        if let Some(ab) = line.strip_prefix("# branch.ab ") {
            let mut parts = ab.split_whitespace();
            s.ahead = parts.next().and_then(|a| a.trim_start_matches('+').parse().ok());
            s.behind = parts.next().and_then(|b| b.trim_start_matches('-').parse().ok());
        } else if !line.starts_with('#') && !line.is_empty() {
            s.dirty += 1;
        }
    }
    s
}

fn git(dir: &str, args: &[&str]) -> String {
    let mut all = vec!["-C", dir];
    all.extend_from_slice(args);
    run("git", &all)
}

pub fn collect_worktrees(root: &Path) -> Vec<Worktree> {
    let mut out = vec![];
    let mut seen = HashSet::new();
    for candidate in find_repos(root, 4) {
        let (Some(repo_path), listed) = parse_worktree_list(&git(&candidate.to_string_lossy(), &["worktree", "list", "--porcelain"])) else { continue };
        if !seen.insert(repo_path.clone()) {
            continue;
        }
        for w in listed {
            if !Path::new(&w.path).is_dir() {
                continue;
            }
            let status = parse_status(&git(&w.path, &["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]));
            let last_commit = git(&w.path, &["log", "-1", "--format=%ct"]).trim().parse::<i64>().ok().map(|s| s * 1000);
            out.push(Worktree { path: w.path, repo: repo_path.clone(), branch: w.branch, dirty: status.dirty, ahead: status.ahead, behind: status.behind, last_commit });
        }
    }
    out
}

fn split_addr(addr: &str, sep: char) -> Option<(String, u16)> {
    let (host, port) = addr.rsplit_once(sep)?;
    Some((host.trim_start_matches('[').trim_end_matches(']').to_string(), port.parse().ok()?))
}

fn is_loopback(ip: &str) -> bool {
    ip.starts_with("127.") || ip == "::1" || ip.starts_with("::ffff:127.") || ip == "localhost"
}

fn local_link(pid: u32, local: (String, u16), peer: (String, u16), listening: &HashSet<u16>) -> Option<Link> {
    (listening.contains(&peer.1) && (is_loopback(&peer.0) || peer.0 == local.0)).then_some(Link { pid, port: peer.1 })
}

pub fn parse_netstat_links(text: &str, listening: &HashSet<u16>) -> Vec<Link> {
    text.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 19 || cols.get(5) != Some(&"ESTABLISHED") {
                return None;
            }
            let local = split_addr(cols[3], '.')?;
            let peer = split_addr(cols[4], '.')?;
            let pid = cols[10..cols.len() - 8].join(" ").rsplit_once(':')?.1.parse().ok()?;
            local_link(pid, local, peer, listening)
        })
        .collect()
}

fn dedupe_links(mut links: Vec<Link>) -> Vec<Link> {
    let mut seen = HashSet::new();
    links.retain(|l| seen.insert((l.pid, l.port)));
    links.sort_by_key(|l| (l.pid, l.port));
    links
}

pub fn collect_links(listening: &HashSet<u16>) -> Vec<Link> {
    let links = if cfg!(target_os = "macos") {
        parse_netstat_links(&run("netstat", &["-anvp", "tcp"]), listening)
    } else {
        procnet::established(Path::new("/proc")).into_iter().filter_map(|c| local_link(c.pid, c.local, c.remote, listening)).collect()
    };
    dedupe_links(links)
}

fn collect_listeners(sys: &mut System) -> Vec<Listener> {
    let raw = ports::collect(|_| None);
    let pids: Vec<sysinfo::Pid> = raw.iter().filter_map(|p| p.pid).map(sysinfo::Pid::from_u32).collect();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, ProcessRefreshKind::nothing().with_memory().with_cwd(UpdateKind::Always).with_cmd(UpdateKind::OnlyIfNotSet));
    raw.into_iter()
        .map(|p| {
            let proc = p.pid.and_then(|pid| sys.process(sysinfo::Pid::from_u32(pid)));
            Listener {
                port: p.port,
                bind: p.bind,
                pid: p.pid,
                process: proc.map(|q| q.name().to_string_lossy().into_owned()).unwrap_or(p.process),
                command: proc.map(|q| q.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")).unwrap_or_default(),
                cwd: proc.and_then(|q| q.cwd()).map(|c| c.to_string_lossy().into_owned()),
                mem_bytes: proc.map_or(0, sysinfo::Process::memory),
            }
        })
        .collect()
}

pub struct Every {
    pub runtime: Duration,
    pub worktrees: Duration,
    pub idle: Duration,
}

const FRESH_WAIT: Duration = Duration::from_secs(10);

struct Shared {
    latest: Projects,
    asked: Option<Instant>,
    generation: u64,
    refresh: bool,
}

pub struct ProjectsService {
    shared: Mutex<Shared>,
    changed: Condvar,
    idle: Duration,
}

impl ProjectsService {
    fn lock(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn wanted(&self, s: &Shared) -> bool {
        s.asked.is_some_and(|t| t.elapsed() < self.idle)
    }

    pub fn current(&self) -> Projects {
        let mut s = self.lock();
        let was_idle = !self.wanted(&s);
        s.asked = Some(Instant::now());
        if !was_idle && !s.refresh {
            return s.latest.clone();
        }
        s.refresh = true;
        self.changed.notify_all();
        let seen = s.generation;
        let (s, _) = self.changed.wait_timeout_while(s, FRESH_WAIT, |s| s.generation == seen).unwrap_or_else(PoisonError::into_inner);
        s.latest.clone()
    }

    #[cfg(test)]
    fn scans(&self) -> u64 {
        self.lock().generation
    }

    fn wait_until_wanted(&self) {
        let s = self.lock();
        drop(self.changed.wait_while(s, |s| !self.wanted(s)).unwrap_or_else(PoisonError::into_inner));
    }

    fn publish(&self, snapshot: Projects) {
        let mut s = self.lock();
        s.latest = snapshot;
        s.generation += 1;
        s.refresh = false;
        self.changed.notify_all();
    }

    fn rest(&self, pause: Duration) {
        let s = self.lock();
        drop(self.changed.wait_timeout_while(s, pause, |s| !s.refresh).unwrap_or_else(PoisonError::into_inner));
    }
}

pub fn start(root: PathBuf, docker_socket: PathBuf, every: Every) -> Arc<ProjectsService> {
    let service = Arc::new(ProjectsService {
        shared: Mutex::new(Shared { latest: Projects { at: 0, root: root.to_string_lossy().into_owned(), worktrees: vec![], listeners: vec![], links: vec![], containers: vec![] }, asked: None, generation: 0, refresh: false }),
        changed: Condvar::new(),
        idle: every.idle,
    });
    let scanner = Arc::clone(&service);
    thread::spawn(move || {
        let mut sys = System::new();
        let mut worktrees = vec![];
        let mut scanned: Option<Instant> = None;
        loop {
            scanner.wait_until_wanted();
            if scanned.is_none_or(|at| at.elapsed() >= every.worktrees) {
                worktrees = collect_worktrees(&root);
                scanned = Some(Instant::now());
            }
            let listeners = collect_listeners(&mut sys);
            let listening: HashSet<u16> = listeners.iter().map(|l| l.port).collect();
            scanner.publish(Projects {
                at: crate::now_ms(),
                root: root.to_string_lossy().into_owned(),
                worktrees: worktrees.clone(),
                links: collect_links(&listening),
                containers: docker::containers(&docker_socket),
                listeners,
            });
            scanner.rest(every.runtime);
        }
    });
    service
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_list_keeps_branches_and_detached_heads_and_drops_prunable_ones() {
        let text = "worktree /r/app\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r/app/worktrees/qa\nHEAD bbb\ndetached\n\nworktree /r/app/worktrees/gone\nHEAD ccc\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
        assert_eq!(
            parse_worktree_list(text),
            (Some("/r/app".into()), vec![ListedWorktree { path: "/r/app".into(), branch: Some("main".into()) }, ListedWorktree { path: "/r/app/worktrees/qa".into(), branch: None }])
        );
    }

    #[test]
    fn a_bare_repo_is_named_after_its_folder_and_only_its_worktrees_are_listed() {
        let text = "worktree /w/databrain-backend/.bare\nbare\n\nworktree /w/databrain-backend/worktrees/qa\nHEAD aaa\nbranch refs/heads/qa\n";
        assert_eq!(parse_worktree_list(text), (Some("/w/databrain-backend".into()), vec![ListedWorktree { path: "/w/databrain-backend/worktrees/qa".into(), branch: Some("qa".into()) }]));
    }

    #[test]
    fn status_counts_changed_and_untracked_entries_and_reads_ahead_behind() {
        let text = "# branch.oid abc\n# branch.head develop\n# branch.upstream origin/develop\n# branch.ab +0 -5\n1 .M N... 100644 100644 100644 a b src/x.ts\n? notes.md\n";
        assert_eq!(parse_status(text), Status { dirty: 2, ahead: Some(0), behind: Some(5) });
        assert_eq!(parse_status("# branch.head main\n"), Status::default());
    }

    #[test]
    fn repos_are_found_under_the_root_without_walking_into_dependencies() {
        let dir = tempfile::tempdir().unwrap();
        for p in ["Personal/a-first/x", "Work/app/.git", "Work/app/sub/.git", "Work/app/node_modules/dep/.git", "Personal/tool/.git", "Personal/notes", "Work/bare/worktrees/qa"] {
            std::fs::create_dir_all(dir.path().join(p)).unwrap();
        }
        std::fs::write(dir.path().join("Work/bare/.git"), "gitdir: ./.bare").unwrap();
        let locked = dir.path().join("Personal/locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::set_permissions(&locked, std::os::unix::fs::PermissionsExt::from_mode(0o000)).unwrap();
        let got: Vec<String> = find_repos(dir.path(), 4).iter().map(|p| p.strip_prefix(dir.path()).unwrap().to_string_lossy().into_owned()).collect();
        std::fs::set_permissions(&locked, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        assert_eq!(got, vec!["Personal/tool", "Work/app", "Work/bare"]);
    }

    #[test]
    fn netstat_links_read_established_rows_with_spaced_process_names() {
        let listening = HashSet::from([8384]);
        let text = "tcp4       0      0  127.0.0.1.52501        127.0.0.1.8384         ESTABLISHED          932         6365  407936  146988 Google Chrome He:97997  00102 00000008 00000000052fee52 00000080 04000900      2      0 000000\n\
tcp4       0      0  127.0.0.1.8384         127.0.0.1.52501        ESTABLISHED        12782          440  401984  146988        syncthing:9107   00102 0000000c 00000000052fee53 00000080 01002800      2      0 000000\n";
        assert_eq!(parse_netstat_links(text, &listening), vec![Link { pid: 97997, port: 8384 }]);
    }

    #[test]
    fn nothing_is_scanned_until_someone_asks_and_the_first_ask_waits_for_a_fresh_scan() {
        let dir = tempfile::tempdir().unwrap();
        let service = start(dir.path().to_path_buf(), dir.path().join("no-docker.sock"), Every { runtime: Duration::from_millis(50), worktrees: Duration::from_secs(60), idle: Duration::from_millis(300) });
        thread::sleep(Duration::from_millis(200));
        assert_eq!(service.scans(), 0);
        let first = service.current();
        assert!(first.at > 0);
        thread::sleep(Duration::from_millis(150));
        assert!(service.scans() >= 2);
        thread::sleep(Duration::from_millis(400));
        let settled = service.scans();
        thread::sleep(Duration::from_millis(300));
        assert_eq!(service.scans(), settled);
    }

    #[test]
    fn an_ask_after_a_quiet_spell_wakes_a_resting_scanner_instead_of_waiting_out_its_pause() {
        let dir = tempfile::tempdir().unwrap();
        let service = start(dir.path().to_path_buf(), dir.path().join("no-docker.sock"), Every { runtime: Duration::from_secs(30), worktrees: Duration::from_secs(60), idle: Duration::from_millis(100) });
        let first = service.current().at;
        thread::sleep(Duration::from_millis(300));
        let asked = Instant::now();
        let second = service.current().at;
        assert!(second > first);
        assert!(asked.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn a_second_ask_during_a_cold_scan_also_waits_for_the_fresh_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let service = start(dir.path().to_path_buf(), dir.path().join("no-docker.sock"), Every { runtime: Duration::from_secs(30), worktrees: Duration::from_secs(60), idle: Duration::from_secs(60) });
        let other = Arc::clone(&service);
        let first = thread::spawn(move || other.current().at);
        let second = service.current().at;
        assert!(second > 0);
        assert!(first.join().unwrap() > 0);
    }
}
