use super::hosts::{GitlabHostCache, ParsedHosts};
use super::wire::RepositoryHostName;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HostAuthorization {
    Allowed,
    NotAllowed,
    Busy,
    CliMissing,
    RefreshFailed,
}

pub(crate) enum HostsRefresh {
    Parsed(ParsedHosts),
    CliMissing,
    Failed,
    Busy,
}

pub(crate) fn authorize_gitlab_host(
    host: &RepositoryHostName,
    cache: &GitlabHostCache,
    refresh: impl FnOnce() -> HostsRefresh,
) -> HostAuthorization {
    if cache.fresh().is_some_and(|parsed| parsed.allows(host)) {
        return HostAuthorization::Allowed;
    }
    if cache.refreshed_recently() {
        return HostAuthorization::NotAllowed;
    }
    match refresh() {
        HostsRefresh::Busy => HostAuthorization::Busy,
        HostsRefresh::CliMissing => HostAuthorization::CliMissing,
        HostsRefresh::Failed => HostAuthorization::RefreshFailed,
        HostsRefresh::Parsed(parsed) => allowance(parsed.allows(host)),
    }
}

pub(crate) fn allowance(allowed: bool) -> HostAuthorization {
    match allowed {
        true => HostAuthorization::Allowed,
        false => HostAuthorization::NotAllowed,
    }
}
