use chrono::DateTime;
use serde_json::{Map, Value};

use crate::schema::{Provider, Tokens};

#[derive(Debug, Clone, PartialEq)]
pub struct UsageRecord {
    pub at: i64,
    pub provider: Provider,
    pub model: String,
    pub session: String,
    pub tokens: Tokens,
    pub dedupe: Option<String>,
}

type Obj = Map<String, Value>;

fn obj(v: Option<&Value>) -> Option<&Obj> {
    v?.as_object()
}

fn text(v: Option<&Value>) -> Option<&str> {
    v?.as_str().filter(|s| !s.is_empty())
}

fn count(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_f64).filter(|n| n.is_finite() && *n > 0.0).map_or(0, |n| n.trunc() as u64)
}

fn time(v: Option<&Value>) -> Option<i64> {
    DateTime::parse_from_rfc3339(v?.as_str()?).ok().map(|d| d.timestamp_millis())
}

fn parse(line: &str) -> Option<Obj> {
    match serde_json::from_str(line) {
        Ok(Value::Object(o)) => Some(o),
        _ => None,
    }
}

pub fn claude_may_carry(line: &str) -> bool {
    line.contains("\"usage\"")
}

pub fn parse_claude_line(line: &str) -> Option<UsageRecord> {
    let r = parse(line)?;
    if r.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = obj(r.get("message"))?;
    let u = obj(message.get("usage"))?;
    let at = time(r.get("timestamp"))?;
    let model = text(message.get("model")).filter(|m| *m != "<synthetic>")?;
    let message_id = text(message.get("id"));
    let request_id = text(r.get("requestId"));
    let tokens = Tokens {
        uncached: count(u.get("input_tokens")),
        cached: count(u.get("cache_read_input_tokens")),
        cache_write: count(u.get("cache_creation_input_tokens")),
        output: count(u.get("output_tokens")),
    };
    let dedupe = (message_id.is_some() || request_id.is_some()).then(|| format!("{}:{}", message_id.unwrap_or(""), request_id.unwrap_or("")));
    Some(UsageRecord { at, provider: Provider::Claude, model: model.to_string(), session: text(r.get("sessionId")).unwrap_or("").to_string(), tokens, dedupe })
}

#[derive(Debug, Default, Clone)]
pub struct CodexState {
    model: String,
    session: String,
    last_signature: Option<String>,
    saw_meta: bool,
    fork_copies: bool,
    fork_anchor: i64,
}

pub fn codex_may_carry(line: &str) -> bool {
    line.contains("\"token_count\"") || line.contains("\"turn_context\"") || line.contains("\"session_meta\"")
}

const FORK_COPY_GAP_MS: i64 = 1000;

fn is_fork(payload: &Obj) -> bool {
    if payload.get("forked_from_id").is_some_and(Value::is_string) {
        return true;
    }
    obj(payload.get("source"))
        .and_then(|s| obj(s.get("subagent")))
        .and_then(|s| obj(s.get("thread_spawn")))
        .is_some_and(|spawn| spawn.get("parent_thread_id").is_some_and(Value::is_string))
}

pub fn parse_codex_line(line: &str, state: &mut CodexState) -> Option<UsageRecord> {
    let r = parse(line)?;
    let p = obj(r.get("payload"))?;
    match r.get("type").and_then(Value::as_str) {
        Some("session_meta") => {
            if state.saw_meta {
                return None;
            }
            state.saw_meta = true;
            if let Some(id) = text(p.get("id")).or_else(|| text(p.get("session_id"))) {
                state.session = id.to_string();
            }
            if let Some(at) = time(r.get("timestamp"))
                && is_fork(p)
            {
                state.fork_copies = true;
                state.fork_anchor = at;
            }
            return None;
        }
        Some("turn_context") => {
            if let Some(model) = text(p.get("model")) {
                state.model = model.to_string();
            }
            return None;
        }
        _ => {}
    }
    if p.get("type").and_then(Value::as_str) != Some("token_count") {
        return None;
    }
    let last_value = obj(p.get("info"))?.get("last_token_usage")?;
    let last = last_value.as_object()?;
    let at = time(r.get("timestamp"))?;
    if state.model.is_empty() {
        return None;
    }
    let signature = last_value.to_string();
    if state.last_signature.as_ref() == Some(&signature) {
        return None;
    }
    state.last_signature = Some(signature);
    if state.fork_copies {
        if at - state.fork_anchor < FORK_COPY_GAP_MS {
            state.fork_anchor = at;
            return None;
        }
        state.fork_copies = false;
    }
    let input = count(last.get("input_tokens"));
    let cached = count(last.get("cached_input_tokens"));
    let cache_write = count(last.get("cache_write_input_tokens"));
    let tokens = Tokens { uncached: input.saturating_sub(cached + cache_write), cached, cache_write, output: count(last.get("output_tokens")) };
    if tokens.total() == 0 {
        return None;
    }
    Some(UsageRecord { at, provider: Provider::Codex, model: state.model.clone(), session: state.session.clone(), tokens, dedupe: None })
}
