use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Deserialize;

use crate::schema::{AgentTailnet, Ping, Via};

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct Node {
    #[serde(rename = "DNSName")]
    pub dns_name: String,
    pub host_name: String,
    #[serde(rename = "OS")]
    pub os: String,
    #[serde(default)]
    pub online: bool,
    #[serde(rename = "TailscaleIPs", default)]
    pub tailscale_ips: Option<Vec<String>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct Status {
    pub version: String,
    #[serde(default)]
    pub peer: Option<HashMap<String, Node>>,
}

impl Node {
    pub fn is_pc(&self) -> bool {
        matches!(self.os.as_str(), "macOS" | "linux" | "windows")
    }

    pub fn name(&self) -> &str {
        match self.dns_name.split('.').next() {
            Some(label) if !label.is_empty() => label,
            _ => &self.host_name,
        }
    }

    pub fn ipv4(&self) -> Option<&str> {
        self.tailscale_ips.as_ref()?.iter().find(|ip| ip.contains('.')).map(String::as_str)
    }
}

pub fn read_status(bin: &str) -> Result<Status, String> {
    let out = Command::new(bin).args(["status", "--json"]).stdin(Stdio::null()).stderr(Stdio::null()).output().map_err(|e| format!("{bin} status: {e}"))?;
    serde_json::from_slice(&out.stdout).map_err(|e| format!("{bin} status --json: {e}"))
}

pub fn ip_of(bin: &str, host: Option<&str>) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(["ip", "-4"]).args(host).stdin(Stdio::null()).stderr(Stdio::null());
    let out = String::from_utf8(cmd.output().ok()?.stdout).ok()?;
    let ip = out.lines().next()?.trim();
    let is_v4 = ip.split('.').count() == 4 && ip.split('.').all(|p| !p.is_empty() && p.parse::<u8>().is_ok());
    is_v4.then(|| ip.to_string())
}

pub fn parse_ping(output: &str) -> Option<(Via, Option<String>, u64)> {
    let start = output.find("via ")? + 4;
    let rest = &output[start..];
    let (via, rest) = rest.split_once(' ')?;
    let ms = rest.strip_prefix("in ")?.split("ms").next()?;
    let ms: f64 = ms.parse().ok()?;
    let region = via.strip_prefix("DERP(").and_then(|r| r.strip_suffix(')')).filter(|r| !r.is_empty() && r.chars().all(|c| c.is_alphanumeric() || c == '_'));
    let kind = if region.is_some() { Via::Relay } else { Via::Direct };
    Some((kind, region.map(str::to_string), ms.round() as u64))
}

fn ping_once(bin: &str, peer: &str, ip: &str) -> Option<Ping> {
    let out = Command::new(bin).args(["ping", "-c", "1", "--timeout", "3s", ip]).stdin(Stdio::null()).output().ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let (via, region, ms) = parse_ping(&text)?;
    Some(Ping { peer: peer.to_string(), via, region, ms })
}

fn refresh(bin: &str) -> Result<AgentTailnet, String> {
    let status = read_status(bin)?;
    let peers: Vec<(String, String)> = status
        .peer
        .unwrap_or_default()
        .values()
        .filter(|n| n.is_pc() && n.online)
        .map(|n| (n.name().to_string(), n.ipv4().unwrap_or_default().to_string()))
        .collect();
    let pings = thread::scope(|s| {
        let handles: Vec<_> = peers.iter().map(|(peer, ip)| s.spawn(move || ping_once(bin, peer, ip))).collect();
        handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
    });
    Ok(AgentTailnet { at: crate::now_ms(), pings })
}

pub fn start_pinging(bin: String, every: Duration) -> Arc<Mutex<AgentTailnet>> {
    let latest = Arc::new(Mutex::new(AgentTailnet::default()));
    let shared = Arc::clone(&latest);
    thread::spawn(move || {
        loop {
            match refresh(&bin) {
                Ok(snapshot) => *shared.lock().unwrap_or_else(PoisonError::into_inner) = snapshot,
                Err(err) => eprintln!("ping refresh failed: {err}"),
            }
            thread::sleep(every);
        }
    });
    latest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ping_reads_direct_and_derp_pongs() {
        assert_eq!(parse_ping("pong from macato (100.64.0.10) via 192.168.200.100:41641 in 5ms"), Some((Via::Direct, None, 5)));
        assert_eq!(parse_ping("pong from x (100.1.1.1) via DERP(blr) in 61ms"), Some((Via::Relay, Some("blr".into()), 61)));
        assert_eq!(parse_ping("ping timed out"), None);
    }
}
