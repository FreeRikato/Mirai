mod transcripts;

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

use walkdir::WalkDir;

use crate::schema::{AgentUsage, Provider, UsageRow};
use transcripts::{CodexState, UsageRecord, claude_may_carry, codex_may_carry, parse_claude_line, parse_codex_line};

const BUCKET_MS: i64 = 30 * 60_000;
const DAY_MS: i64 = 86_400_000;
const CHUNK_BYTES: u64 = 4 * 1024 * 1024;

struct FileState {
    size: u64,
    mtime_ms: i64,
    offset: u64,
    codex: CodexState,
    rows: HashMap<(i64, String, String), UsageRow>,
    keys: Vec<String>,
}

pub struct Scanner {
    claude_dir: PathBuf,
    codex_dir: PathBuf,
    days: i64,
    files: HashMap<PathBuf, FileState>,
    seen: HashSet<String>,
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0 && entry.file_name().to_str().is_some_and(|n| n.starts_with('.'))
}

fn list_files(claude_dir: &Path, codex_dir: &Path) -> HashMap<PathBuf, Provider> {
    let sources = [(Provider::Claude, claude_dir.join("projects")), (Provider::Codex, codex_dir.join("sessions")), (Provider::Codex, codex_dir.join("archived_sessions"))];
    let mut out = HashMap::new();
    for (provider, root) in sources {
        let entries = WalkDir::new(root).into_iter().filter_entry(|e| !is_hidden(e)).filter_map(Result::ok);
        for entry in entries.filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "jsonl")) {
            out.insert(entry.into_path(), provider);
        }
    }
    out
}

impl Scanner {
    pub fn new(claude_dir: PathBuf, codex_dir: PathBuf, days: i64) -> Self {
        Scanner { claude_dir, codex_dir, days, files: HashMap::new(), seen: HashSet::new() }
    }

    fn forget(&mut self, path: &Path) {
        if let Some(f) = self.files.remove(path) {
            for k in f.keys {
                self.seen.remove(&k);
            }
        }
    }

    fn add(seen: &mut HashSet<String>, f: &mut FileState, rec: UsageRecord) {
        if let Some(key) = rec.dedupe {
            if !seen.insert(key.clone()) {
                return;
            }
            f.keys.push(key);
        }
        let bucket = rec.at.div_euclid(BUCKET_MS) * BUCKET_MS;
        f.rows
            .entry((bucket, rec.model.clone(), rec.session.clone()))
            .and_modify(|row| row.add(&rec.tokens))
            .or_insert_with(|| UsageRow {
                bucket,
                provider: rec.provider,
                model: rec.model,
                session: rec.session,
                uncached: rec.tokens.uncached,
                cached: rec.tokens.cached,
                cache_write: rec.tokens.cache_write,
                output: rec.tokens.output,
            });
    }

    fn scan_file(&mut self, path: &Path, provider: Provider, cutoff: i64) {
        let Ok(meta) = std::fs::metadata(path) else { return self.forget(path) };
        let size = meta.len();
        let mtime_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as i64);
        match self.files.get(path) {
            None if mtime_ms < cutoff => return,
            Some(f) if f.size == size && f.mtime_ms == mtime_ms => return,
            Some(f) if size < f.offset => self.forget(path),
            _ => {}
        }
        let Ok(mut file) = File::open(path) else { return };
        let f = self.files.entry(path.to_path_buf()).or_insert_with(|| FileState { size: 0, mtime_ms: 0, offset: 0, codex: CodexState::default(), rows: HashMap::new(), keys: vec![] });
        f.size = size;
        f.mtime_ms = mtime_ms;
        let mut chunk = CHUNK_BYTES;
        while f.offset < size {
            let len = chunk.min(size - f.offset);
            let mut bytes = Vec::with_capacity(len as usize);
            if file.seek(SeekFrom::Start(f.offset)).is_err() || file.by_ref().take(len).read_to_end(&mut bytes).is_err() {
                return;
            }
            let Some(end) = bytes.iter().rposition(|b| *b == b'\n') else {
                if f.offset + chunk >= size {
                    return;
                }
                chunk *= 2;
                continue;
            };
            chunk = CHUNK_BYTES;
            f.offset += end as u64 + 1;
            for line in String::from_utf8_lossy(&bytes[..end]).split('\n') {
                let rec = match provider {
                    Provider::Claude => claude_may_carry(line).then(|| parse_claude_line(line)).flatten(),
                    Provider::Codex => codex_may_carry(line).then(|| parse_codex_line(line, &mut f.codex)).flatten(),
                };
                if let Some(rec) = rec.filter(|r| r.at >= cutoff) {
                    Self::add(&mut self.seen, f, rec);
                }
            }
        }
    }

    pub fn scan(&mut self, now_ms: i64) -> AgentUsage {
        let cutoff = now_ms - self.days * DAY_MS;
        let listed = list_files(&self.claude_dir, &self.codex_dir);
        let gone: Vec<PathBuf> = self.files.keys().filter(|p| !listed.contains_key(*p)).cloned().collect();
        for path in gone {
            self.forget(&path);
        }
        for (path, provider) in &listed {
            self.scan_file(path, *provider, cutoff);
        }
        let mut merged: HashMap<(Provider, i64, &str, &str), UsageRow> = HashMap::new();
        for row in self.files.values().flat_map(|f| f.rows.values()).filter(|r| r.bucket >= cutoff) {
            merged.entry((row.provider, row.bucket, &row.model, &row.session)).and_modify(|m| m.add(&row.tokens())).or_insert_with(|| row.clone());
        }
        AgentUsage { at: now_ms, rows: merged.into_values().collect() }
    }
}

struct Latest {
    usage: Option<Arc<String>>,
    at: i64,
    scanning: bool,
}

pub struct UsageService {
    scanner: Mutex<Scanner>,
    latest: Mutex<Latest>,
    ready: Condvar,
    stale_after: Duration,
}

impl UsageService {
    pub fn start(scanner: Scanner, stale_after: Duration) -> Arc<Self> {
        let service = Arc::new(UsageService { scanner: Mutex::new(scanner), latest: Mutex::new(Latest { usage: None, at: 0, scanning: false }), ready: Condvar::new(), stale_after });
        service.rescan();
        service
    }

    fn rescan(self: &Arc<Self>) {
        {
            let mut latest = self.latest.lock().unwrap_or_else(PoisonError::into_inner);
            if latest.scanning {
                return;
            }
            latest.scanning = true;
        }
        let me = Arc::clone(self);
        thread::spawn(move || {
            let now = crate::now_ms();
            let usage = me.scanner.lock().unwrap_or_else(PoisonError::into_inner).scan(now);
            let json = serde_json::to_string(&usage).unwrap_or_else(|_| format!("{{\"at\":{now},\"rows\":[]}}"));
            let mut latest = me.latest.lock().unwrap_or_else(PoisonError::into_inner);
            *latest = Latest { usage: Some(Arc::new(json)), at: now, scanning: false };
            me.ready.notify_all();
        });
    }

    pub fn current(self: &Arc<Self>) -> Arc<String> {
        let mut latest = self.latest.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(usage) = latest.usage.clone() {
            let stale = crate::now_ms() - latest.at > self.stale_after.as_millis() as i64;
            drop(latest);
            if stale {
                self.rescan();
            }
            return usage;
        }
        if !latest.scanning {
            drop(latest);
            self.rescan();
            latest = self.latest.lock().unwrap_or_else(PoisonError::into_inner);
        }
        loop {
            if let Some(usage) = latest.usage.clone() {
                return usage;
            }
            latest = self.ready.wait(latest).unwrap_or_else(PoisonError::into_inner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs::{OpenOptions, create_dir_all, write};
    use std::io::Write;

    fn ts(s: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).expect("valid timestamp")
    }

    fn now() -> i64 {
        ts("2026-09-24T12:00:00Z")
    }

    fn home() -> tempfile::TempDir {
        let root = tempfile::tempdir().expect("tempdir");
        create_dir_all(root.path().join("claude/projects/app")).expect("mkdir");
        create_dir_all(root.path().join("codex/sessions/2026/09/24")).expect("mkdir");
        root
    }

    fn scanner(root: &Path, days: i64) -> Scanner {
        Scanner::new(root.join("claude"), root.join("codex"), days)
    }

    fn claude(id: &str, at: &str, output: u64, session: &str) -> String {
        let line = json!({ "type": "assistant", "timestamp": at, "sessionId": session, "requestId": format!("req-{id}"), "message": { "id": id, "model": "claude-opus-5-5", "usage": { "input_tokens": 10, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 5, "output_tokens": output } } });
        format!("{line}\n")
    }

    fn output(rows: &[UsageRow]) -> u64 {
        rows.iter().map(|r| r.output).sum()
    }

    #[test]
    fn claude_messages_repeated_across_content_blocks_and_files_count_once_and_appends_are_picked_up_incrementally() {
        let root = home();
        let a = root.path().join("claude/projects/app/a.jsonl");
        write(&a, [claude("m1", "2026-09-24T10:05:00Z", 50, "s1"), claude("m1", "2026-09-24T10:05:00Z", 50, "s1"), claude("m2", "2026-09-24T10:40:00Z", 7, "s1")].concat()).expect("write");
        write(root.path().join("claude/projects/app/b.jsonl"), claude("m1", "2026-09-24T10:05:00Z", 50, "s2")).expect("write");
        let mut s = scanner(root.path(), 90);

        let first = s.scan(now());
        assert_eq!(output(&first.rows), 57);
        let mut buckets: Vec<i64> = first.rows.iter().map(|r| r.bucket).collect();
        buckets.sort();
        assert_eq!(buckets, [ts("2026-09-24T10:00:00Z"), ts("2026-09-24T10:30:00Z")]);

        OpenOptions::new().append(true).open(&a).and_then(|mut f| f.write_all(claude("m3", "2026-09-24T11:00:00Z", 3, "s1").as_bytes())).expect("append");
        assert_eq!(output(&s.scan(now()).rows), 60);
    }

    #[test]
    fn a_rewritten_file_is_reread_from_the_start_without_losing_its_own_messages_to_the_dedupe_set() {
        let root = home();
        let a = root.path().join("claude/projects/app/a.jsonl");
        write(&a, [claude("m1", "2026-09-24T10:05:00Z", 50, "s1"), claude("m2", "2026-09-24T10:06:00Z", 50, "s1")].concat()).expect("write");
        let mut s = scanner(root.path(), 90);
        s.scan(now());
        write(&a, claude("m1", "2026-09-24T10:05:00Z", 50, "s1")).expect("rewrite");
        assert_eq!(output(&s.scan(now()).rows), 50);
    }

    #[test]
    fn codex_takes_the_model_from_turn_context_skips_repeated_token_counts_and_the_copied_history_of_a_fork() {
        let root = home();
        let usage = |input: u64, cached: u64, output: u64| json!({ "type": "token_count", "info": { "last_token_usage": { "input_tokens": input, "cached_input_tokens": cached, "output_tokens": output } } });
        let lines = |ls: Vec<serde_json::Value>| ls.iter().map(|l| format!("{l}\n")).collect::<String>();
        let dir = root.path().join("codex/sessions/2026/09/24");
        write(
            dir.join("rollout-a.jsonl"),
            lines(vec![
                json!({ "type": "session_meta", "timestamp": "2026-09-24T09:00:00Z", "payload": { "id": "c1" } }),
                json!({ "type": "event_msg", "timestamp": "2026-09-24T09:00:01Z", "payload": usage(100, 60, 10) }),
                json!({ "type": "turn_context", "timestamp": "2026-09-24T09:00:02Z", "payload": { "model": "gpt-6-astra" } }),
                json!({ "type": "event_msg", "timestamp": "2026-09-24T09:00:03Z", "payload": usage(100, 60, 10) }),
                json!({ "type": "event_msg", "timestamp": "2026-09-24T09:00:04Z", "payload": usage(100, 60, 10) }),
            ]),
        )
        .expect("write");
        write(
            dir.join("rollout-fork.jsonl"),
            lines(vec![
                json!({ "type": "session_meta", "timestamp": "2026-09-24T09:10:00Z", "payload": { "id": "c2", "forked_from_id": "c1" } }),
                json!({ "type": "turn_context", "timestamp": "2026-09-24T09:10:00Z", "payload": { "model": "gpt-6-astra" } }),
                json!({ "type": "event_msg", "timestamp": "2026-09-24T09:10:00.100Z", "payload": usage(100, 60, 10) }),
                json!({ "type": "event_msg", "timestamp": "2026-09-24T09:10:30Z", "payload": usage(40, 0, 4) }),
            ]),
        )
        .expect("write");
        let rows = scanner(root.path(), 90).scan(now()).rows;
        let c1 = rows.iter().find(|r| r.session == "c1").expect("c1 row");
        assert_eq!((c1.provider, c1.model.as_str(), c1.uncached, c1.cached, c1.output), (Provider::Codex, "gpt-6-astra", 40, 60, 10));
        assert_eq!(rows.iter().find(|r| r.session == "c2").map(|r| r.tokens().total()), Some(44));
    }

    #[test]
    fn records_older_than_the_window_are_left_out() {
        let root = home();
        write(root.path().join("claude/projects/app/a.jsonl"), [claude("old", "2026-05-01T10:00:00Z", 9, "s1"), claude("new", "2026-09-20T10:00:00Z", 1, "s1")].concat()).expect("write");
        let rows = scanner(root.path(), 30).scan(now()).rows;
        assert_eq!(rows.iter().map(|r| r.output).collect::<Vec<_>>(), [1]);
    }
}
