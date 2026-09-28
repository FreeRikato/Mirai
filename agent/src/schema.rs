use std::collections::BTreeMap;

use serde::{Deserialize, Serialize, Serializer};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub os: String,
    pub kernel: String,
    pub cpu_model: String,
    pub threads: usize,
    pub mem_total: u64,
    pub agent_version: String,
    pub tailscale_version: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Cpu {
    pub load: f32,
    pub cores: Vec<f32>,
    pub load_avg: [f64; 3],
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mem {
    pub total: u64,
    pub used: u64,
    pub cache: u64,
    pub free: u64,
    pub swap_used: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Disk {
    pub mount: String,
    pub used: u64,
    pub size: u64,
}

#[derive(Serialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Io {
    pub net_in: f64,
    pub net_out: f64,
    pub disk_read: f64,
    pub disk_write: f64,
}

#[derive(Serialize, Clone, Copy, Debug)]
pub struct Temp {
    pub cpu: f32,
    pub max: f32,
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub percent: f32,
    pub charging: bool,
    pub on_ac: bool,
    pub cycles: Option<u32>,
    pub health_pct: Option<u32>,
}

#[derive(Serialize, Debug)]
pub struct TopProc {
    pub name: String,
    pub cpu: f64,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SystemThemeMode {
    Dark,
    Light,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemTheme {
    pub mode: SystemThemeMode,
    pub colors: BTreeMap<String, String>,
    pub mono_font: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub at: i64,
    pub info: Info,
    pub uptime_sec: u64,
    pub cpu: Cpu,
    pub mem: Mem,
    pub disks: Vec<Disk>,
    pub io: Io,
    pub temp: Option<Temp>,
    pub battery: Option<Battery>,
    pub top_procs: Vec<TopProc>,
    pub failed_services: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<SystemTheme>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub user: String,
    pub cpu: f64,
    pub mem_bytes: u64,
    pub started: String,
    pub killable: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Port {
    pub port: u16,
    pub proto: String,
    pub bind: String,
    pub pid: Option<u32>,
    pub process: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Failed,
    Restarting,
    Running,
    Stopped,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceKind {
    Systemd,
    Launchd,
    Docker,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Service {
    pub name: String,
    pub kind: ServiceKind,
    pub state: ServiceState,
    pub detail: String,
    pub since: Option<String>,
    pub restarts: Option<u32>,
    pub ports: String,
}

#[derive(Serialize, Debug)]
pub struct HostDetail {
    pub at: i64,
    pub processes: Vec<Process>,
    pub ports: Vec<Port>,
    pub services: Vec<Service>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub repo: String,
    pub branch: Option<String>,
    pub dirty: u32,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub last_commit: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub port: u16,
    pub bind: String,
    pub pid: Option<u32>,
    pub process: String,
    pub command: String,
    pub cwd: Option<String>,
    pub mem_bytes: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Link {
    pub pid: u32,
    pub port: u16,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub name: String,
    pub compose_project: Option<String>,
    pub compose_service: Option<String>,
    pub working_dir: Option<String>,
    pub ports: Vec<u16>,
    pub mem_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Projects {
    pub at: i64,
    pub root: String,
    pub worktrees: Vec<Worktree>,
    pub listeners: Vec<Listener>,
    pub links: Vec<Link>,
    pub containers: Vec<Container>,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub enum KillSignal {
    #[serde(rename = "SIGTERM")]
    Term,
    #[serde(rename = "SIGKILL")]
    Kill,
}

#[derive(Deserialize, Debug)]
pub struct KillRequest {
    pub pid: i64,
    pub name: String,
    pub signal: KillSignal,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    Direct,
    Relay,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Ping {
    pub peer: String,
    pub via: Via,
    pub region: Option<String>,
    pub ms: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct AgentTailnet {
    pub at: i64,
    pub pings: Vec<Ping>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Tokens {
    pub uncached: u64,
    pub cached: u64,
    pub cache_write: u64,
    pub output: u64,
}

impl Tokens {
    pub fn total(&self) -> u64 {
        self.uncached + self.cached + self.cache_write + self.output
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    pub bucket: i64,
    pub provider: Provider,
    pub model: String,
    pub session: String,
    pub uncached: u64,
    pub cached: u64,
    pub cache_write: u64,
    pub output: u64,
}

impl UsageRow {
    pub fn tokens(&self) -> Tokens {
        Tokens { uncached: self.uncached, cached: self.cached, cache_write: self.cache_write, output: self.output }
    }

    pub fn add(&mut self, t: &Tokens) {
        self.uncached += t.uncached;
        self.cached += t.cached;
        self.cache_write += t.cache_write;
        self.output += t.output;
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentUsage {
    pub at: i64,
    pub rows: Vec<UsageRow>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub id: String,
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct Flag<const B: bool>;

impl<const B: bool> Serialize for Flag<B> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(B)
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiveLimits {
    pub ok: Flag<true>,
    pub provider: Provider,
    pub account: String,
    pub plan: Option<String>,
    pub checked_at: i64,
    pub windows: Vec<LimitWindow>,
    pub reset_credits: Option<u64>,
}

#[derive(Serialize, Debug)]
pub struct FailedLimits {
    pub ok: Flag<false>,
    pub provider: Provider,
    pub error: String,
}

#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum ProviderLimits {
    Live(LiveLimits),
    Failed(FailedLimits),
}

impl ProviderLimits {
    pub fn failed(provider: Provider, error: impl Into<String>) -> Self {
        ProviderLimits::Failed(FailedLimits { ok: Flag, provider, error: error.into() })
    }
}
