use super::wire::{
    is_repository_host, RepositoryHostName, RepositoryInfo, RepositoryLookupOutcome,
    RepositoryProvider,
};
use serde::{Deserialize, Serialize};
pub(crate) const PAGE_SIZE: usize = 20;
pub(crate) const MAX_PAGES: u8 = 10;
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepositorySearchRequestWire {
    provider: RepositoryProvider,
    host: String,
    query: String,
    page: u8,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RepositorySearchRequest {
    pub(crate) provider: RepositoryProvider,
    pub(crate) host: RepositoryHostName,
    pub(crate) query: String,
    pub(crate) page: u8,
}
impl RepositorySearchRequest {
    pub(crate) fn validate(wire: &RepositorySearchRequestWire) -> Option<Self> {
        if !is_repository_host(&wire.host)
            || !valid_query(&wire.query)
            || !(1..=MAX_PAGES).contains(&wire.page)
        {
            return None;
        }
        Some(Self {
            provider: wire.provider,
            host: RepositoryHostName::lowercased(&wire.host)?,
            query: wire.query.clone(),
            page: wire.page,
        })
    }
}
pub(super) fn valid_query(query: &str) -> bool {
    !query.is_empty()
        && query.len() <= 100
        && query.trim() == query
        && !query.contains("..")
        && query.as_bytes()[0].is_ascii_alphanumeric()
        && query
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._ /-".contains(&b))
}
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub(crate) enum RepositorySearchOutcome {
    Page(RepositorySearchPage),
    Failure(RepositoryLookupOutcome),
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySearchPage {
    pub(crate) status: &'static str,
    pub(crate) repositories: Vec<RepositoryInfo>,
    pub(crate) next_page: Option<u8>,
    pub(crate) truncated: bool,
}
