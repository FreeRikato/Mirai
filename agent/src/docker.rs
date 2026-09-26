use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;

use crate::schema::Container;

const TIMEOUT: Duration = Duration::from_secs(3);

pub fn get(socket: &Path, path: &str) -> Option<String> {
    let mut stream = UnixStream::connect(socket).ok()?;
    stream.set_read_timeout(Some(TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TIMEOUT)).ok()?;
    write!(stream, "GET {path} HTTP/1.0\r\nHost: docker\r\n\r\n").ok()?;
    let mut raw = vec![];
    stream.read_to_end(&mut raw).ok()?;
    body_of(&String::from_utf8(raw).ok()?)
}

pub fn body_of(response: &str) -> Option<String> {
    let (head, body) = response.split_once("\r\n\r\n")?;
    let status = head.lines().next()?.split_whitespace().nth(1)?;
    (status == "200").then(|| body.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ApiContainer {
    id: String,
    names: Vec<String>,
    state: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    labels: HashMap<String, String>,
    #[serde(default)]
    ports: Vec<ApiPort>,
}

pub struct Running {
    pub id: String,
    pub name: String,
    pub restarting: bool,
    pub status: String,
    pub labels: HashMap<String, String>,
    pub ports: Vec<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ApiPort {
    public_port: Option<u16>,
}

#[derive(Deserialize)]
struct ApiStats {
    memory_stats: MemoryStats,
}

#[derive(Deserialize)]
struct MemoryStats {
    usage: Option<u64>,
    #[serde(default)]
    stats: HashMap<String, u64>,
}

pub fn parse_memory(stats: &str) -> u64 {
    let Ok(s) = serde_json::from_str::<ApiStats>(stats) else { return 0 };
    let m = s.memory_stats;
    let inactive = m.stats.get("inactive_file").or_else(|| m.stats.get("total_inactive_file")).copied().unwrap_or(0);
    m.usage.unwrap_or(0).saturating_sub(inactive)
}

pub fn parse_running(list: &str) -> Vec<Running> {
    let rows: Vec<ApiContainer> = serde_json::from_str(list).unwrap_or_default();
    rows.into_iter()
        .filter(|r| r.state == "running" || r.state == "restarting")
        .map(|r| {
            let mut ports: Vec<u16> = r.ports.iter().filter_map(|p| p.public_port).collect();
            ports.sort_unstable();
            ports.dedup();
            Running { name: r.names.first().map(|n| n.trim_start_matches('/').to_string()).unwrap_or_default(), restarting: r.state == "restarting", status: r.status, labels: r.labels, ports, id: r.id }
        })
        .collect()
}

pub fn running(socket: &Path) -> Vec<Running> {
    get(socket, "/containers/json").map(|list| parse_running(&list)).unwrap_or_default()
}

pub fn parse_containers(list: &str, memory_of: impl Fn(&str) -> u64) -> Vec<Container> {
    let mut out: Vec<Container> = parse_running(list)
        .into_iter()
        .map(|mut r| Container {
            compose_project: r.labels.remove("com.docker.compose.project"),
            compose_service: r.labels.remove("com.docker.compose.service"),
            working_dir: r.labels.remove("com.docker.compose.project.working_dir"),
            mem_bytes: memory_of(&r.id),
            ports: r.ports,
            name: r.name,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn containers(socket: &Path) -> Vec<Container> {
    let Some(list) = get(socket, "/containers/json") else { return vec![] };
    parse_containers(&list, |id| get(socket, &format!("/containers/{id}/stats?stream=false&one-shot=true")).map_or(0, |s| parse_memory(&s)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;
    use std::thread;

    const LIST: &str = r#"[
        {"Id":"aaa","Names":["/qa-graphql-engine-1"],"State":"running","Labels":{"com.docker.compose.project":"qa","com.docker.compose.service":"graphql-engine","com.docker.compose.project.working_dir":"/w/qa","com.docker.compose.project.config_files":"/w/qa/a.yaml,/w/qa/b.yaml"},"Ports":[{"IP":"0.0.0.0","PrivatePort":8080,"PublicPort":20182,"Type":"tcp"},{"IP":"::","PrivatePort":8080,"PublicPort":20182,"Type":"tcp"},{"PrivatePort":9000,"Type":"tcp"}]},
        {"Id":"bbb","Names":["/lonely"],"State":"running","Labels":{},"Ports":[]},
        {"Id":"ccc","Names":["/stopped"],"State":"exited","Labels":{},"Ports":[]}
    ]"#;

    #[test]
    fn running_containers_keep_their_compose_labels_published_ports_and_memory() {
        let got = parse_containers(LIST, |id| if id == "aaa" { 512 } else { 0 });
        assert_eq!(
            got,
            vec![
                Container { name: "lonely".into(), compose_project: None, compose_service: None, working_dir: None, ports: vec![], mem_bytes: 0 },
                Container { name: "qa-graphql-engine-1".into(), compose_project: Some("qa".into()), compose_service: Some("graphql-engine".into()), working_dir: Some("/w/qa".into()), ports: vec![20182], mem_bytes: 512 },
            ]
        );
    }

    #[test]
    fn memory_leaves_out_reclaimable_file_cache_like_docker_stats_does() {
        assert_eq!(parse_memory(r#"{"memory_stats":{"usage":300000000,"stats":{"inactive_file":100000000,"anon":150000000}}}"#), 200_000_000);
        assert_eq!(parse_memory(r#"{"memory_stats":{"usage":300,"stats":{"total_inactive_file":100}}}"#), 200);
        assert_eq!(parse_memory(r#"{"memory_stats":{}}"#), 0);
        assert_eq!(parse_memory("not json"), 0);
    }

    #[test]
    fn only_a_200_reply_has_a_usable_body() {
        assert_eq!(body_of("HTTP/1.0 200 OK\r\nApi-Version: 1.55\r\n\r\n[]"), Some("[]".into()));
        assert_eq!(body_of("HTTP/1.0 404 Not Found\r\n\r\n{\"message\":\"no such container\"}"), None);
        assert_eq!(body_of("garbage"), None);
    }

    #[test]
    fn talks_to_the_docker_socket_without_spawning_the_cli() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("docker.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let server = thread::spawn(move || {
            let mut asked = vec![];
            for _ in 0..3 {
                let (mut conn, _) = listener.accept().unwrap();
                let mut buf = [0u8; 1024];
                let n = conn.read(&mut buf).unwrap();
                let line = String::from_utf8_lossy(&buf[..n]).lines().next().unwrap_or_default().to_string();
                let body = if line.contains("/containers/json") { LIST.to_string() } else { r#"{"memory_stats":{"usage":2048,"stats":{"inactive_file":1024}}}"#.to_string() };
                write!(conn, "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{body}").unwrap();
                asked.push(line);
            }
            asked
        });
        let got = containers(&socket);
        assert_eq!(got.iter().map(|c| (c.name.as_str(), c.mem_bytes)).collect::<Vec<_>>(), vec![("lonely", 1024), ("qa-graphql-engine-1", 1024)]);
        let asked = server.join().unwrap();
        assert_eq!(asked[0], "GET /containers/json HTTP/1.0");
        assert!(asked[1..].iter().all(|l| l.contains("/stats?stream=false&one-shot=true")));
    }

    #[test]
    fn no_docker_means_no_containers() {
        assert!(containers(Path::new("/nonexistent/docker.sock")).is_empty());
    }
}
