use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use chrono::DateTime;
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::schema::{Flag, LimitWindow, LiveLimits, Provider, ProviderLimits};

const HOUR_MS: i64 = 3_600_000;
const SESSION_MS: i64 = 5 * HOUR_MS;
const WEEK_MS: i64 = 7 * 24 * HOUR_MS;

pub struct Sources {
    pub claude_dir: PathBuf,
    pub claude_config: PathBuf,
    pub codex_dir: PathBuf,
    pub claude_url: String,
    pub codex_url: String,
    pub timeout: Duration,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeOauth {
    access_token: String,
    expires_at: Option<f64>,
    subscription_type: Option<String>,
    rate_limit_tier: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCreds {
    claude_ai_oauth: ClaudeOauth,
}

#[derive(Deserialize)]
struct ScopeModel {
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct Scope {
    model: Option<ScopeModel>,
}

#[derive(Deserialize)]
struct ClaudeLimit {
    kind: String,
    group: String,
    percent: f64,
    resets_at: Option<String>,
    scope: Option<Scope>,
}

#[derive(Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    limits: Vec<ClaudeLimit>,
}

#[derive(Deserialize)]
struct OauthAccount {
    #[serde(rename = "accountUuid")]
    account_uuid: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeConfig {
    oauth_account: Option<OauthAccount>,
}

#[derive(Deserialize)]
struct CodexTokens {
    access_token: String,
    account_id: String,
}

#[derive(Deserialize)]
struct CodexAuth {
    auth_mode: Option<String>,
    tokens: Option<CodexTokens>,
}

#[derive(Deserialize)]
struct CodexWindow {
    used_percent: f64,
    limit_window_seconds: f64,
    reset_at: Option<f64>,
}

#[derive(Deserialize)]
struct CodexRateLimit {
    primary_window: Option<CodexWindow>,
    secondary_window: Option<CodexWindow>,
}

#[derive(Deserialize)]
struct ResetCredits {
    available_count: u64,
}

#[derive(Deserialize)]
struct CodexUsage {
    plan_type: Option<String>,
    rate_limit: Option<CodexRateLimit>,
    rate_limit_reset_credits: Option<ResetCredits>,
}

fn clamp(n: f64) -> f64 {
    n.clamp(0.0, 100.0)
}

pub fn claude_plan(subscription: Option<&str>, tier: Option<&str>) -> Option<String> {
    let multiplier = tier.and_then(|t| t.rsplit_once('_')).map(|(_, m)| m).filter(|m| m.len() > 1 && m.ends_with('x') && m[..m.len() - 1].chars().all(|c| c.is_ascii_digit()));
    match (subscription, multiplier) {
        (Some(s), Some(m)) => Some(format!("{s} {m}")),
        (s, _) => s.map(str::to_string),
    }
}

fn claude_windows(usage: ClaudeUsage) -> Vec<LimitWindow> {
    usage
        .limits
        .into_iter()
        .map(|l| {
            let scoped = l.scope.and_then(|s| s.model).and_then(|m| m.display_name).map(|n| n.to_lowercase());
            let base = match l.group.as_str() {
                "session" => "session".to_string(),
                "weekly" => "weekly".to_string(),
                _ => l.kind.replace('_', " "),
            };
            let resets_at = l.resets_at.and_then(|r| DateTime::parse_from_rfc3339(&r).ok()).map(|d| d.timestamp_millis());
            LimitWindow {
                id: scoped.as_ref().map_or_else(|| l.kind.clone(), |s| format!("{}:{s}", l.kind)),
                label: scoped.as_ref().map_or_else(|| base.clone(), |s| format!("{base} · {s}")),
                used_percent: clamp(l.percent),
                resets_at,
                duration_ms: if l.group == "session" { SESSION_MS } else { WEEK_MS },
            }
        })
        .collect()
}

fn codex_label(ms: i64) -> String {
    match ms {
        SESSION_MS => "session".into(),
        WEEK_MS => "weekly".into(),
        _ if ms % (24 * HOUR_MS) == 0 => format!("{}d", ms / (24 * HOUR_MS)),
        _ => format!("{}h", (ms as f64 / HOUR_MS as f64).round()),
    }
}

struct CodexLimits {
    plan: Option<String>,
    windows: Vec<LimitWindow>,
    reset_credits: Option<u64>,
}

fn codex_limits(u: CodexUsage) -> CodexLimits {
    let (primary, secondary) = u.rate_limit.map_or((None, None), |r| (r.primary_window, r.secondary_window));
    let windows = [("primary", primary), ("secondary", secondary)]
        .into_iter()
        .filter_map(|(id, w)| {
            let w = w.filter(|w| w.limit_window_seconds > 0.0)?;
            let duration_ms = (w.limit_window_seconds * 1000.0) as i64;
            Some(LimitWindow {
                id: id.into(),
                label: codex_label(duration_ms),
                used_percent: clamp(w.used_percent),
                resets_at: w.reset_at.filter(|r| *r != 0.0).map(|r| (r * 1000.0) as i64),
                duration_ms,
            })
        })
        .collect();
    CodexLimits { plan: u.plan_type, windows, reset_credits: u.rate_limit_reset_credits.map(|c| c.available_count) }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

enum FetchError {
    Status(u16),
    Failed(String),
}

fn get_json<T: DeserializeOwned>(url: &str, headers: &[(&str, &str)], timeout: Duration) -> Result<T, FetchError> {
    let agent = ureq::Agent::new_with_config(ureq::config::Config::builder().timeout_global(Some(timeout)).http_status_as_error(false).build());
    let mut req = agent.get(url);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let mut res = req.call().map_err(|e| FetchError::Failed(e.to_string()))?;
    let status = res.status().as_u16();
    if status != 200 {
        return Err(FetchError::Status(status));
    }
    res.body_mut().read_json().map_err(|e| FetchError::Failed(e.to_string()))
}

fn claude(src: &Sources, now: i64) -> ProviderLimits {
    let Some(creds) = read_json::<ClaudeCreds>(&src.claude_dir.join(".credentials.json")) else {
        return ProviderLimits::failed(Provider::Claude, "not logged in to claude");
    };
    let oauth = creds.claude_ai_oauth;
    if oauth.expires_at.is_some_and(|at| at < now as f64) {
        return ProviderLimits::failed(Provider::Claude, "login expired; run claude once to refresh it");
    }
    let bearer = format!("Bearer {}", oauth.access_token);
    let usage = match get_json::<ClaudeUsage>(&src.claude_url, &[("authorization", &bearer), ("anthropic-beta", "oauth-2025-04-20")], src.timeout) {
        Ok(u) => u,
        Err(FetchError::Status(status)) => return ProviderLimits::failed(Provider::Claude, format!("usage endpoint answered {status}")),
        Err(FetchError::Failed(e)) => return ProviderLimits::failed(Provider::Claude, e),
    };
    let account = read_json::<ClaudeConfig>(&src.claude_config).and_then(|c| c.oauth_account).map_or_else(|| "claude".to_string(), |a| a.account_uuid);
    ProviderLimits::Live(LiveLimits {
        ok: Flag,
        provider: Provider::Claude,
        account,
        plan: claude_plan(oauth.subscription_type.as_deref(), oauth.rate_limit_tier.as_deref()),
        checked_at: now,
        windows: claude_windows(usage),
        reset_credits: None,
    })
}

fn codex(src: &Sources, now: i64) -> ProviderLimits {
    let auth = read_json::<CodexAuth>(&src.codex_dir.join("auth.json"));
    let Some(tokens) = auth.as_ref().and_then(|a| a.tokens.as_ref()) else {
        let api_key = auth.and_then(|a| a.auth_mode).is_some_and(|m| m == "apikey");
        return ProviderLimits::failed(Provider::Codex, if api_key { "api key login has no plan limits" } else { "not logged in to codex" });
    };
    let bearer = format!("Bearer {}", tokens.access_token);
    let headers = [("authorization", bearer.as_str()), ("chatgpt-account-id", tokens.account_id.as_str()), ("user-agent", "codex_cli_rs")];
    let usage = match get_json::<CodexUsage>(&src.codex_url, &headers, src.timeout) {
        Ok(u) => u,
        Err(FetchError::Status(401)) => return ProviderLimits::failed(Provider::Codex, "login expired; run codex once to refresh it"),
        Err(FetchError::Status(status)) => return ProviderLimits::failed(Provider::Codex, format!("usage endpoint answered {status}")),
        Err(FetchError::Failed(e)) => return ProviderLimits::failed(Provider::Codex, e),
    };
    let limits = codex_limits(usage);
    ProviderLimits::Live(LiveLimits {
        ok: Flag,
        provider: Provider::Codex,
        account: tokens.account_id.clone(),
        plan: limits.plan,
        checked_at: now,
        windows: limits.windows,
        reset_credits: limits.reset_credits,
    })
}

pub fn read(src: &Sources, now: i64) -> Vec<ProviderLimits> {
    thread::scope(|s| {
        let c = s.spawn(|| claude(src, now));
        let x = s.spawn(|| codex(src, now));
        vec![
            c.join().unwrap_or_else(|_| ProviderLimits::failed(Provider::Claude, "could not read limits")),
            x.join().unwrap_or_else(|_| ProviderLimits::failed(Provider::Codex, "could not read limits")),
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_limits_become_session_weekly_and_model_scoped_weekly_windows() {
        let body = r#"{"limits":[
            {"kind":"session","group":"session","percent":25,"resets_at":"2026-09-24T15:30:00+00:00","scope":null},
            {"kind":"weekly_all","group":"weekly","percent":60,"resets_at":"2026-09-26T20:00:00+00:00","scope":null},
            {"kind":"weekly_scoped","group":"weekly","percent":11,"resets_at":null,"scope":{"model":{"id":null,"display_name":"Fable"}}}
        ]}"#;
        let ts = |s: &str| DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).ok();
        assert_eq!(
            claude_windows(serde_json::from_str(body).expect("fixture parses")),
            vec![
                LimitWindow { id: "session".into(), label: "session".into(), used_percent: 25.0, resets_at: ts("2026-09-24T15:30:00Z"), duration_ms: SESSION_MS },
                LimitWindow { id: "weekly_all".into(), label: "weekly".into(), used_percent: 60.0, resets_at: ts("2026-09-26T20:00:00Z"), duration_ms: WEEK_MS },
                LimitWindow { id: "weekly_scoped:fable".into(), label: "weekly · fable".into(), used_percent: 11.0, resets_at: None, duration_ms: WEEK_MS },
            ]
        );
    }

    #[test]
    fn the_plan_label_carries_the_max_multiplier() {
        assert_eq!(claude_plan(Some("max"), Some("default_claude_max_20x")).as_deref(), Some("max 20x"));
        assert_eq!(claude_plan(Some("pro"), None).as_deref(), Some("pro"));
    }

    #[test]
    fn codex_windows_are_labelled_by_their_length_and_keep_the_banked_reset_credits() {
        let body = r#"{"plan_type":"plus","rate_limit":{
            "primary_window":{"used_percent":1,"limit_window_seconds":18000,"reset_at":1790270856},
            "secondary_window":{"used_percent":9,"limit_window_seconds":604800,"reset_at":1790740628}},
            "rate_limit_reset_credits":{"available_count":2}}"#;
        let out = codex_limits(serde_json::from_str(body).expect("fixture parses"));
        assert_eq!(out.plan.as_deref(), Some("plus"));
        assert_eq!(out.reset_credits, Some(2));
        let got: Vec<(String, f64, Option<i64>)> = out.windows.into_iter().map(|w| (w.label, w.used_percent, w.resets_at)).collect();
        assert_eq!(got, vec![("session".into(), 1.0, Some(1_790_270_856_000)), ("weekly".into(), 9.0, Some(1_790_740_628_000))]);
    }
}
