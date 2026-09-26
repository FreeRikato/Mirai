mod config;
mod docker;
mod hub_guard;
mod kill;
mod limits;
mod metrics;
mod open;
mod ports;
mod procnet;
mod processes;
mod projects;
mod schema;
mod services;
mod tailscale;
mod usage;

use std::io::Read;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;

use serde::Serialize;
use serde_json::json;
use tiny_http::{Header, Method, Request, Response, Server};

use config::Config;
use hub_guard::HubGuard;
use kill::{Outcome, Running};
use metrics::{Sampler, Settings};
use projects::ProjectsService;
use schema::{AgentTailnet, HostDetail, KillRequest};
use usage::{Scanner, UsageService};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

const WORKERS: usize = 4;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

type Resolver = Box<dyn Fn() -> Option<String> + Send + Sync>;

struct Agent {
    config: Config,
    user: String,
    sampler: Mutex<Sampler>,
    tailnet: Arc<Mutex<AgentTailnet>>,
    projects: Arc<ProjectsService>,
    usage: Arc<UsageService>,
    hub: Option<HubGuard<Resolver>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn json_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes("content-type", "application/json;charset=utf-8").expect("static header is valid");
    Response::from_string(body).with_status_code(status).with_header(header)
}

fn json_of(status: u16, body: &impl Serialize) -> Response<std::io::Cursor<Vec<u8>>> {
    json_response(status, serde_json::to_string(body).unwrap_or_else(|e| json!({ "error": e.to_string() }).to_string()))
}

fn outcome(o: Outcome) -> Response<std::io::Cursor<Vec<u8>>> {
    json_of(o.status, &o.body)
}

fn header<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn from_hub(req: &Request) -> bool {
    header(req, "origin").is_none() && header(req, "content-type").is_some_and(|c| c.starts_with("application/json"))
}

fn read_body<T: serde::de::DeserializeOwned>(req: &mut Request) -> Option<T> {
    let mut body = String::new();
    req.as_reader().take(64 * 1024).read_to_string(&mut body).ok()?;
    serde_json::from_str(&body).ok()
}

impl Agent {
    fn detail(&self) -> HostDetail {
        let mut s = lock(&self.sampler);
        s.refresh();
        let list = s.processes();
        let owner = processes::Owner { user: &self.user, self_pid: std::process::id() };
        let processes = processes::pick_processes(&list, self.config.max_processes, &owner);
        HostDetail { at: now_ms(), processes, ports: s.ports(&list), services: s.services() }
    }

    fn kill(&self, req: &KillRequest) -> Outcome {
        if req.name.is_empty() || req.pid <= 0 {
            return Outcome { status: 400, body: json!({ "error": "expected { pid, name, signal }" }) };
        }
        let pid = u32::try_from(req.pid).unwrap_or_default();
        let name = lock(&self.sampler).current_name(pid);
        let running: Vec<Running> = name.iter().map(|name| Running { pid, name }).collect();
        kill::kill_process(req, &running, std::process::id(), kill::send_signal)
    }

    fn limits(&self) -> Vec<schema::ProviderLimits> {
        let c = &self.config;
        let sources = limits::Sources {
            claude_dir: c.claude_dir.clone(),
            claude_config: c.claude_config.clone(),
            codex_dir: c.codex_dir.clone(),
            claude_url: c.claude_usage_url.clone(),
            codex_url: c.codex_usage_url.clone(),
            timeout: c.limits_timeout,
        };
        limits::read(&sources, now_ms())
    }

    fn handle(&self, mut req: Request) {
        let path = req.url().split('?').next().unwrap_or("").to_string();
        let post = *req.method() == Method::Post;
        if path == "/health" {
            let _ = req.respond(json_of(200, &json!({ "ok": true, "version": VERSION })));
            return;
        }
        let known = matches!(path.as_str(), "/metrics" | "/detail" | "/tailnet" | "/usage" | "/limits" | "/projects") || (post && matches!(path.as_str(), "/kill" | "/open"));
        if !known {
            let _ = req.respond(Response::from_string("not found").with_status_code(404));
            return;
        }
        if let Some(guard) = &self.hub
            && !guard.allows(req.remote_addr().map(|a| a.ip()), now_ms())
        {
            let hub = self.config.hub.as_deref().unwrap_or_default();
            let _ = req.respond(json_of(403, &json!({ "error": format!("only the mirai hub on {hub} may call this agent") })));
            return;
        }
        let response = match path.as_str() {
            "/metrics" => json_of(200, &lock(&self.sampler).metrics()),
            "/detail" => json_of(200, &self.detail()),
            "/tailnet" => json_of(200, &*lock(&self.tailnet)),
            "/projects" => json_of(200, &self.projects.current()),
            "/usage" => json_response(200, self.usage.current().to_string()),
            "/limits" => json_of(200, &self.limits()),
            "/kill" if !from_hub(&req) => json_of(403, &json!({ "error": "kill requests come from the hub only" })),
            "/kill" => match read_body::<KillRequest>(&mut req) {
                Some(k) => outcome(self.kill(&k)),
                None => json_of(400, &json!({ "error": "expected { pid, name, signal }" })),
            },
            "/open" if !from_hub(&req) => json_of(403, &json!({ "error": "open requests come from the hub only" })),
            _ => match read_body::<open::OpenRequest>(&mut req).filter(|o| open::is_web_url(&o.url)) {
                Some(o) => outcome(open::open_url(&o.url)),
                None => json_of(400, &json!({ "error": "expected { url } with an http(s) url" })),
            },
        };
        if let Err(e) = req.respond(response) {
            eprintln!("[agent] {path}: could not answer: {e}");
        }
    }
}

fn run() -> Result<(), String> {
    let config = Config::from_env()?;
    let bin = config.tailscale_bin.clone();
    let host = match &config.host {
        Some(h) => h.clone(),
        None => tailscale::ip_of(&bin, None).ok_or("no tailscale IPv4 address; is tailscale up?")?,
    };
    let home = std::env::var("HOME").map_err(|_| "HOME is not set")?;
    let uid = rustix::process::getuid().as_raw();
    let user = sysinfo::Users::new_with_refreshed_list().iter().find(|u| **u.id() == uid).map(|u| u.name().to_string()).ok_or("cannot find the user this agent runs as")?;
    let hub = config.hub.clone().map(|name| {
        let bin = bin.clone();
        let resolve: Resolver = Box::new(move || tailscale::ip_of(&bin, Some(&name)));
        HubGuard::new(resolve)
    });
    let sampler = Sampler::new(Settings { tailscale_bin: bin.clone(), info_cache: config.info_cache, sample_cache: config.sample_cache, detail_cache: config.detail_cache, services_cache: config.services_cache, home: home.into(), docker_socket: config.docker_socket.clone() });
    let tailnet = tailscale::start_pinging(bin, config.ping_every);
    let projects = projects::start(config.projects_root.clone(), config.docker_socket.clone(), projects::Every { runtime: config.projects_every, worktrees: config.worktrees_every, idle: config.projects_idle });
    let usage = UsageService::start(Scanner::new(config.claude_dir.clone(), config.codex_dir.clone(), config.usage_days), config.usage_cache);
    let server = Arc::new(Server::http((host.as_str(), config.port)).map_err(|e| format!("cannot listen on {host}:{}: {e}", config.port))?);
    let agent = Arc::new(Agent { config, user, sampler: Mutex::new(sampler), tailnet, projects, usage, hub });
    println!("mirai-agent {VERSION} on http://{host}:{}/", agent.config.port);
    let workers: Vec<_> = (0..WORKERS)
        .map(|_| {
            let server = Arc::clone(&server);
            let agent = Arc::clone(&agent);
            thread::spawn(move || {
                for req in server.incoming_requests() {
                    agent.handle(req);
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("mirai-agent: {e}");
        std::process::exit(1);
    }
}
