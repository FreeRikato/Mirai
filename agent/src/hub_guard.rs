use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Mutex, PoisonError};

const RETRY_MS: i64 = 30_000;

pub fn plain_address(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(ip, IpAddr::V4),
        IpAddr::V4(_) => ip,
    }
}

struct State {
    known: Option<Ipv4Addr>,
    failed_at: Option<i64>,
}

pub struct HubGuard<R: Fn() -> Option<String>> {
    resolve: R,
    state: Mutex<State>,
}

impl<R: Fn() -> Option<String>> HubGuard<R> {
    pub fn new(resolve: R) -> Self {
        HubGuard { resolve, state: Mutex::new(State { known: None, failed_at: None }) }
    }

    fn hub_address(&self, now_ms: i64) -> Option<Ipv4Addr> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.known.is_some() {
            return state.known;
        }
        if state.failed_at.is_some_and(|at| now_ms - at < RETRY_MS) {
            return None;
        }
        state.known = (self.resolve)().and_then(|ip| ip.parse().ok());
        if state.known.is_none() {
            state.failed_at = Some(now_ms);
        }
        state.known
    }

    pub fn allows(&self, remote: Option<IpAddr>, now_ms: i64) -> bool {
        let Some(remote) = remote else { return false };
        self.hub_address(now_ms).is_some_and(|hub| plain_address(remote) == IpAddr::V4(hub))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn ip(s: &str) -> Option<IpAddr> {
        s.parse().ok()
    }

    #[test]
    fn only_the_hubs_tailnet_address_is_let_through_including_its_ipv4_mapped_form() {
        let guard = HubGuard::new(|| Some("100.64.0.20".to_string()));
        assert!(guard.allows(ip("100.64.0.20"), 0));
        assert!(guard.allows(ip("::ffff:100.64.0.20"), 0));
        assert!(!guard.allows(ip("100.64.0.10"), 0));
        assert!(!guard.allows(None, 0));
    }

    #[test]
    fn an_unresolvable_hub_denies_everyone_and_is_retried_only_after_a_pause() {
        let calls = Cell::new(0);
        let answer: RefCell<Option<String>> = RefCell::new(None);
        let guard = HubGuard::new(|| {
            calls.set(calls.get() + 1);
            answer.borrow().clone()
        });
        assert!(!guard.allows(ip("100.1.1.1"), 0));
        *answer.borrow_mut() = Some("100.1.1.1".into());
        assert!(!guard.allows(ip("100.1.1.1"), 0));
        assert_eq!(calls.get(), 1);
        assert!(guard.allows(ip("100.1.1.1"), 31_000));
    }
}
