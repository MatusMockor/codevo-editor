use serde::Deserialize;

use super::clone_url::has_host;
use super::repository_path::RepositoryPath;
use super::sanitize::{bounded_branch, bounded_description};
use super::wire::{
    is_https_clone_url, is_ssh_clone_url, RepositoryHostName, RepositoryInfo, RepositoryProvider,
    RepositoryVisibility,
};

#[derive(Debug, Deserialize)]
struct GitlabProjectView {
    path_with_namespace: String,
    description: Option<String>,
    visibility: Option<String>,
    default_branch: Option<String>,
    ssh_url_to_repo: Option<String>,
    http_url_to_repo: Option<String>,
}

pub(crate) fn parse_repository(host: &RepositoryHostName, stdout: &[u8]) -> Option<RepositoryInfo> {
    let view = serde_json::from_slice::<GitlabProjectView>(stdout).ok()?;
    let path = RepositoryPath::parse(RepositoryProvider::Gitlab, &view.path_with_namespace)?;
    Some(RepositoryInfo {
        provider: RepositoryProvider::Gitlab,
        host: host.as_str().to_string(),
        full_path: path.as_str().to_string(),
        description: view.description.as_deref().and_then(bounded_description),
        visibility: parse_visibility(view.visibility.as_deref()),
        default_branch: view.default_branch.as_deref().and_then(bounded_branch),
        ssh_url: pinned_url(view.ssh_url_to_repo, host, is_ssh_clone_url),
        https_url: pinned_url(view.http_url_to_repo, host, is_https_clone_url),
    })
}

fn pinned_url(
    value: Option<String>,
    host: &RepositoryHostName,
    accepted: fn(&str) -> bool,
) -> Option<String> {
    value.filter(|url| accepted(url.as_str()) && has_host(url.as_str(), host.as_str()))
}

fn parse_visibility(value: Option<&str>) -> RepositoryVisibility {
    let Some(value) = value else {
        return RepositoryVisibility::Unknown;
    };
    match value.to_ascii_lowercase().as_str() {
        "public" => RepositoryVisibility::Public,
        "private" => RepositoryVisibility::Private,
        "internal" => RepositoryVisibility::Internal,
        _ => RepositoryVisibility::Unknown,
    }
}
