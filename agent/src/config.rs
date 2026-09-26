use std::env;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Config {
    pub tailscale_bin: String,
    pub port: u16,
    pub host: Option<String>,
    pub hub: Option<String>,
    pub ping_every: Duration,
    pub info_cache: Duration,
    pub sample_cache: Duration,
    pub detail_cache: Duration,
    pub services_cache: Duration,
    pub max_processes: usize,
    pub claude_dir: PathBuf,
    pub claude_config: PathBuf,
    pub codex_dir: PathBuf,
    pub usage_days: i64,
    pub usage_cache: Duration,
    pub limits_timeout: Duration,
    pub claude_usage_url: String,
    pub codex_usage_url: String,
    pub projects_root: PathBuf,
    pub projects_every: Duration,
    pub worktrees_every: Duration,
    pub projects_idle: Duration,
    pub docker_socket: PathBuf,
}

fn read(name: &str) -> Option<String> {
    env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn text(name: &str, default: &str) -> String {
    read(name).unwrap_or_else(|| default.to_string())
}

fn positive<T: FromStr + PartialOrd + Default>(name: &str, default: T) -> Result<T, String> {
    match read(name) {
        None => Ok(default),
        Some(raw) => match raw.parse::<T>() {
            Ok(v) if v > T::default() => Ok(v),
            _ => Err(format!("{name} must be a positive integer, got {raw:?}")),
        },
    }
}

fn millis(name: &str, default: u64) -> Result<Duration, String> {
    positive(name, default).map(Duration::from_millis)
}

fn url(name: &str, default: &str) -> Result<String, String> {
    let v = text(name, default);
    if v.starts_with("https://") || v.starts_with("http://") { Ok(v) } else { Err(format!("{name} must be an http(s) url, got {v:?}")) }
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let home = PathBuf::from(env::var("HOME").map_err(|_| "HOME is not set".to_string())?);
        Ok(Config {
            tailscale_bin: text("TAILSCALE_BIN", "tailscale"),
            port: positive("MIRAI_AGENT_PORT", 7070)?,
            host: read("MIRAI_AGENT_HOST"),
            hub: read("MIRAI_AGENT_HUB"),
            ping_every: millis("MIRAI_AGENT_PING_MS", 60_000)?,
            info_cache: millis("MIRAI_AGENT_INFO_CACHE_MS", 60 * 60_000)?,
            sample_cache: millis("MIRAI_AGENT_SAMPLE_CACHE_MS", 10_000)?,
            detail_cache: millis("MIRAI_AGENT_DETAIL_CACHE_MS", 5_000)?,
            services_cache: millis("MIRAI_AGENT_SERVICES_CACHE_MS", 15_000)?,
            max_processes: positive("MIRAI_AGENT_MAX_PROCESSES", 120)?,
            claude_dir: read("MIRAI_AGENT_CLAUDE_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude")),
            claude_config: read("MIRAI_AGENT_CLAUDE_CONFIG").map(PathBuf::from).unwrap_or_else(|| home.join(".claude.json")),
            codex_dir: read("MIRAI_AGENT_CODEX_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".codex")),
            usage_days: positive("MIRAI_AGENT_USAGE_DAYS", 90)?,
            usage_cache: millis("MIRAI_AGENT_USAGE_CACHE_MS", 60_000)?,
            limits_timeout: millis("MIRAI_AGENT_LIMITS_TIMEOUT_MS", 10_000)?,
            claude_usage_url: url("CLAUDE_USAGE_URL", "https://api.anthropic.com/api/oauth/usage")?,
            codex_usage_url: url("CODEX_USAGE_URL", "https://chatgpt.com/backend-api/wham/usage")?,
            projects_root: read("MIRAI_AGENT_PROJECTS_ROOT").map(PathBuf::from).unwrap_or_else(|| home.join("Developer")),
            projects_every: millis("MIRAI_AGENT_PROJECTS_MS", 10_000)?,
            worktrees_every: millis("MIRAI_AGENT_WORKTREES_MS", 60_000)?,
            projects_idle: millis("MIRAI_AGENT_PROJECTS_IDLE_MS", 30_000)?,
            docker_socket: PathBuf::from(read("DOCKER_HOST").and_then(|h| h.strip_prefix("unix://").map(str::to_string)).unwrap_or_else(|| "/var/run/docker.sock".to_string())),
        })
    }
}
