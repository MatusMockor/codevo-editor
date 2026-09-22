use super::authority::HostAuthorization;
use super::classify::classify_failure;
use super::plan::CliPlan;
use super::process::ProcessError;
use super::repository_path::RepositoryPath;
use super::search_wire::{
    RepositorySearchOutcome, RepositorySearchPage, RepositorySearchRequest, MAX_PAGES, PAGE_SIZE,
};
use super::service::RepositoryLookupService;
use super::wire::{
    RepositoryInfo, RepositoryLookupFailureReason, RepositoryLookupOutcome, RepositoryProvider,
};
use super::{github, gitlab};
use serde::Deserialize;
use std::collections::BTreeSet;

impl RepositoryLookupService {
    pub(crate) fn search(&self, request: RepositorySearchRequest) -> RepositorySearchOutcome {
        match self.authorize_host(request.provider, &request.host) {
            HostAuthorization::NotAllowed => {
                return failure(RepositoryLookupOutcome::HostNotAllowed)
            }
            HostAuthorization::Busy => return failed(RepositoryLookupFailureReason::Busy),
            HostAuthorization::CliMissing => return failure(RepositoryLookupOutcome::CliMissing),
            HostAuthorization::RefreshFailed => {
                return failed(RepositoryLookupFailureReason::Unknown)
            }
            HostAuthorization::Allowed => {}
        }
        let Some(lease) = self.slot_for(request.provider).acquire() else {
            return failed(RepositoryLookupFailureReason::Busy);
        };
        let plan = CliPlan::RepositorySearch {
            request: request.clone(),
        };
        let Some(executable) = self.executables.resolve(plan.program()) else {
            return failure(RepositoryLookupOutcome::CliMissing);
        };
        let result = self.run(&executable, &plan, &lease);
        if lease.superseded() {
            return failure(RepositoryLookupOutcome::Superseded);
        }
        let output = match result {
            Ok(output) => output,
            Err(ProcessError::TimedOut) => return failure(RepositoryLookupOutcome::TimedOut),
            Err(ProcessError::OutputTooLarge) => {
                return failed(RepositoryLookupFailureReason::OutputTooLarge)
            }
            Err(ProcessError::Io) => return failed(RepositoryLookupFailureReason::Unknown),
        };
        if !output.success {
            let path = RepositoryPath::parse(request.provider, "search/query")
                .expect("constant valid repository path");
            let stderr =
                super::sanitize::bounded_lossy_text(&output.stderr, super::plan::MAX_STDERR_BYTES)
                    .to_lowercase();
            let stderr = stderr.replace(&request.query.to_ascii_lowercase(), " ");
            return failure(classify_failure(stderr.as_bytes(), &path));
        }
        parse_page(&request, &output.stdout)
            .map(RepositorySearchOutcome::Page)
            .unwrap_or_else(|| failed(RepositoryLookupFailureReason::InvalidOutput))
    }
}
#[derive(Deserialize)]
struct GithubPage {
    items: Vec<serde_json::Value>,
    total_count: u64,
    incomplete_results: bool,
}
pub(super) fn parse_page(
    request: &RepositorySearchRequest,
    bytes: &[u8],
) -> Option<RepositorySearchPage> {
    let (values, more, incomplete) = match request.provider {
        RepositoryProvider::Github => {
            let page: GithubPage = serde_json::from_slice(bytes).ok()?;
            (
                page.items,
                page.total_count > u64::from(request.page) * PAGE_SIZE as u64,
                page.incomplete_results,
            )
        }
        RepositoryProvider::Gitlab => {
            let items: Vec<serde_json::Value> = serde_json::from_slice(bytes).ok()?;
            let more = items.len() == PAGE_SIZE;
            (items, more, false)
        }
    };
    if values.len() > PAGE_SIZE {
        return None;
    }
    let repositories = values
        .iter()
        .map(|value| parse_item(request, value))
        .collect::<Option<Vec<_>>>()?;
    let unique = repositories
        .iter()
        .map(|r| r.full_path.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    if unique.len() != repositories.len() || repositories.iter().any(|r| !r.is_valid()) {
        return None;
    }
    Some(RepositorySearchPage {
        status: "ok",
        repositories,
        next_page: (more && request.page < MAX_PAGES).then_some(request.page + 1),
        truncated: incomplete || (more && request.page == MAX_PAGES),
    })
}
fn parse_item(
    request: &RepositorySearchRequest,
    value: &serde_json::Value,
) -> Option<RepositoryInfo> {
    let bytes = match request.provider {
        RepositoryProvider::Github => serde_json::to_vec(&serde_json::json!({
            "nameWithOwner": value.get("full_name")?, "url": value.get("html_url")?,
            "description": value.get("description"), "visibility": value.get("visibility").cloned().unwrap_or_else(|| serde_json::json!(match value.get("private").and_then(|v| v.as_bool()) { Some(true) => "private", Some(false) => "public", None => "unknown" })),
            "defaultBranchRef": {"name": value.get("default_branch")}
        })).ok()?,
        RepositoryProvider::Gitlab => serde_json::to_vec(value).ok()?,
    };
    match request.provider {
        RepositoryProvider::Github => github::parse_repository(&bytes),
        RepositoryProvider::Gitlab => gitlab::parse_repository(&request.host, &bytes),
    }
}
fn failure(outcome: RepositoryLookupOutcome) -> RepositorySearchOutcome {
    RepositorySearchOutcome::Failure(outcome)
}
fn failed(reason: RepositoryLookupFailureReason) -> RepositorySearchOutcome {
    failure(RepositoryLookupOutcome::Failed { reason })
}
