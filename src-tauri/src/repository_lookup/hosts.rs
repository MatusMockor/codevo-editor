use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::clock::Clock;
use super::wire::{
    is_repository_host, RepositoryHost, RepositoryHostAuth, RepositoryHostName, RepositoryProvider,
    MAX_HOSTS_PER_PROVIDER,
};

pub(crate) const HOSTS_CACHE_TTL: Duration = Duration::from_secs(60);
pub(crate) const HOSTS_REFRESH_DEBOUNCE: Duration = Duration::from_secs(5);

const MAX_SCANNED_LINES: usize = 512;
const MAX_SCANNED_LINE_CHARS: usize = 512;
const MAX_PORT_CHARS: usize = 5;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ParsedHosts {
    pub(crate) hosts: Vec<RepositoryHost>,
    pub(crate) truncated: bool,
}

impl ParsedHosts {
    pub(crate) fn allows(&self, host: &RepositoryHostName) -> bool {
        self.hosts.iter().any(|entry| entry.host == host.as_str())
    }
}

pub(crate) fn parse_glab_auth_status(output: &str) -> ParsedHosts {
    let mut parsed = ParsedHosts::default();
    let mut current: Option<String> = None;
    for line in output.lines().take(MAX_SCANNED_LINES) {
        if line.chars().count() > MAX_SCANNED_LINE_CHARS {
            continue;
        }
        if line.starts_with([' ', '\t']) {
            mark_authenticated(&mut parsed, current.as_deref(), line);
            continue;
        }
        current = open_host_block(&mut parsed, line);
    }
    parsed
}

fn open_host_block(parsed: &mut ParsedHosts, line: &str) -> Option<String> {
    let Some(host) = host_line(line) else {
        if is_ported_host_line(line) {
            parsed.truncated = true;
        }
        return None;
    };
    if parsed.hosts.iter().any(|entry| entry.host == host) {
        return Some(host);
    }
    if parsed.hosts.len() == MAX_HOSTS_PER_PROVIDER {
        parsed.truncated = true;
        return None;
    }
    parsed.hosts.push(RepositoryHost {
        provider: RepositoryProvider::Gitlab,
        host: host.clone(),
        auth: RepositoryHostAuth::NotAuthenticated,
    });
    Some(host)
}

fn mark_authenticated(parsed: &mut ParsedHosts, current: Option<&str>, line: &str) {
    let Some(host) = current else {
        return;
    };
    if !is_logged_in_line(line, host) {
        return;
    }
    let Some(entry) = parsed.hosts.iter_mut().find(|entry| entry.host == host) else {
        return;
    };
    entry.auth = RepositoryHostAuth::Authenticated;
}

fn host_line(line: &str) -> Option<String> {
    RepositoryHostName::lowercased(host_candidate(line)).map(|host| host.as_str().to_string())
}

fn is_ported_host_line(line: &str) -> bool {
    let candidate = host_candidate(line);
    let Some((host, port)) = candidate.rsplit_once(':') else {
        return false;
    };
    if !is_repository_host(&host.to_ascii_lowercase()) {
        return false;
    }
    if port.is_empty() || port.len() > MAX_PORT_CHARS {
        return false;
    }
    port.parse::<u16>().is_ok_and(|port| port > 0)
}

fn host_candidate(line: &str) -> &str {
    let trimmed = line.trim();
    trimmed.strip_suffix(':').unwrap_or(trimmed)
}

fn is_logged_in_line(line: &str, host: &str) -> bool {
    line.to_lowercase()
        .contains(&format!("logged in to {host} as"))
}

pub(crate) struct GitlabHostCache {
    clock: Arc<dyn Clock>,
    state: Mutex<Option<CachedHosts>>,
}

struct CachedHosts {
    parsed: ParsedHosts,
    refreshed_at: Instant,
}

impl GitlabHostCache {
    pub(crate) fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            clock,
            state: Mutex::new(None),
        }
    }

    pub(crate) fn fresh(&self) -> Option<ParsedHosts> {
        self.aged(HOSTS_CACHE_TTL).map(|cached| cached.parsed)
    }

    pub(crate) fn debounced(&self) -> Option<ParsedHosts> {
        self.aged(HOSTS_REFRESH_DEBOUNCE)
            .map(|cached| cached.parsed)
    }

    pub(crate) fn refreshed_recently(&self) -> bool {
        self.debounced().is_some()
    }

    pub(crate) fn store(&self, parsed: ParsedHosts) {
        *self.lock() = Some(CachedHosts {
            parsed,
            refreshed_at: self.clock.now(),
        });
    }

    pub(crate) fn invalidate(&self) {
        *self.lock() = None;
    }

    fn aged(&self, limit: Duration) -> Option<CachedHosts> {
        let now = self.clock.now();
        self.lock()
            .as_ref()
            .filter(|cached| now.saturating_duration_since(cached.refreshed_at) < limit)
            .map(|cached| CachedHosts {
                parsed: cached.parsed.clone(),
                refreshed_at: cached.refreshed_at,
            })
    }

    fn lock(&self) -> MutexGuard<'_, Option<CachedHosts>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
