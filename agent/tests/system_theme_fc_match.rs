use std::fs;
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::Value;
use tempfile::TempDir;

struct Agent {
    child: Child,
    base: String,
    _home: TempDir,
    _bin: TempDir,
}

impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .expect("a free local port")
}

fn write(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().expect("path has a parent")).expect("create parent dirs");
    fs::write(path, body).expect("write file");
}

fn start() -> Agent {
    start_with_fc_match(
        "#!/bin/sh\nif [ \"$1\" = \"monospace\" ] && [ \"$2\" = \"-f\" ] && [ \"$3\" = \"%{family}\\\\n\" ]; then\n  printf '%s\\n' 'JetBrainsMono Nerd Font,JetBrainsMono NF'\nelse\n  printf '%s\\n' 'JetBrainsMonoNerdFont-Regular.ttf: \"JetBrainsMono Nerd Font\" \"Regular\"'\nfi\n",
    )
}

fn start_with_fc_match(fc_match: &str) -> Agent {
    let home = tempfile::tempdir().expect("temp home");
    let bin = tempfile::tempdir().expect("temp bin");
    write(
        &home.path().join(".local/state/omarchy/current/theme/colors.toml"),
        "mode = \"dark\"\nbackground = \"#1a1b26\"\nforeground = \"#a9b1d6\"\n",
    );
    write(
        &home.path().join(".config/fontconfig/fonts.conf"),
        "<fontconfig><match><edit name=\"family\"><string>JetBrainsMono Nerd Font</string></edit></match></fontconfig>\n",
    );
    let script = bin.path().join("fc-match");
    fs::write(&script, fc_match).expect("write fc-match stub");
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod fc-match stub");

    let port = free_port();
    let path = format!("{}:{}", bin.path().display(), std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into()));
    let child = Command::new(env!("CARGO_BIN_EXE_mirai-agent"))
        .env_clear()
        .env("HOME", home.path())
        .env("PATH", path)
        .env("TAILSCALE_BIN", "/usr/bin/false")
        .env("MIRAI_AGENT_HOST", "127.0.0.1")
        .env("MIRAI_AGENT_PORT", port.to_string())
        .env("MIRAI_AGENT_SAMPLE_CACHE_MS", "100")
        .env("MIRAI_AGENT_PROJECTS_ROOT", home.path().join("Developer"))
        .env("DOCKER_HOST", format!("unix://{}", home.path().join("docker.sock").display()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn mirai-agent");
    let agent = Agent { child, base: format!("http://127.0.0.1:{port}"), _home: home, _bin: bin };
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if ureq::get(format!("{}/health", agent.base)).call().is_ok() {
            return agent;
        }
        sleep(Duration::from_millis(100));
    }
    panic!("mirai-agent did not come up on {}", agent.base);
}

#[test]
fn failed_fc_match_omits_monospace_font() {
    let agent = start_with_fc_match("#!/bin/sh\nexit 1\n");
    let body = metrics(&agent);
    let system = body["system"].as_object().expect("system theme");
    assert!(!system.contains_key("monoFont"));
}

fn metrics(agent: &Agent) -> Value {
    let body = ureq::get(format!("{}/metrics", agent.base))
        .call()
        .expect("GET /metrics")
        .body_mut()
        .read_to_string()
        .expect("read /metrics body");
    serde_json::from_str(&body).expect("/metrics is JSON")
}

#[test]
fn fc_match_is_asked_for_the_monospace_family_not_the_font_file() {
    let agent = start();
    assert_eq!(metrics(&agent)["system"]["monoFont"], "JetBrainsMono Nerd Font");
}
