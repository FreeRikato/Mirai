use std::process::{Command, Stdio};

use serde::Deserialize;
use serde_json::json;

use crate::kill::Outcome;

#[derive(Deserialize)]
pub struct OpenRequest {
    pub url: String,
}

pub fn is_web_url(url: &str) -> bool {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"));
    rest.is_some_and(|r| r.split(['/', '?', '#']).next().is_some_and(|host| !host.is_empty()) && !url.chars().any(|c| c.is_whitespace() || c.is_control()))
}

pub fn open_command(url: &str, macos: bool) -> Vec<&str> {
    if macos { vec!["open", url] } else { vec!["systemd-run", "--user", "--collect", "--quiet", "xdg-open", url] }
}

pub fn open_url(url: &str) -> Outcome {
    let cmd = open_command(url, cfg!(target_os = "macos"));
    let out = Command::new(cmd[0]).args(&cmd[1..]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).output();
    match out {
        Ok(o) if o.status.success() => Outcome { status: 200, body: json!({ "ok": true }) },
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            let code = o.status.code().map_or_else(|| "a signal".to_string(), |c| c.to_string());
            Outcome { status: 500, body: json!({ "error": if stderr.is_empty() { format!("opener exited with {code}") } else { stderr } }) }
        }
        Err(e) => Outcome { status: 500, body: json!({ "error": e.to_string() }) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_urls_with_a_host_are_opened() {
        assert!(is_web_url("https://example.com/a?b=1"));
        assert!(is_web_url("http://localhost:3000"));
        assert!(!is_web_url("file:///etc/passwd"));
        assert!(!is_web_url("https://"));
        assert!(!is_web_url("https://example.com/a b"));
    }

    #[test]
    fn linux_opens_through_a_transient_user_unit_so_the_browser_outlives_the_request() {
        assert_eq!(open_command("https://x.dev", true), ["open", "https://x.dev"]);
        assert_eq!(open_command("https://x.dev", false), ["systemd-run", "--user", "--collect", "--quiet", "xdg-open", "https://x.dev"]);
    }
}
