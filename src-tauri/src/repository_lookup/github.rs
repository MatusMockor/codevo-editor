use serde::Deserialize;

use super::clone_url::has_host;
use super::repository_path::RepositoryPath;
use super::sanitize::{bounded_branch, bounded_description};
use super::wire::{
    is_https_clone_url, is_ssh_clone_url, RepositoryInfo, RepositoryProvider, RepositoryVisibility,
    GITHUB_HOST,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubRepositoryView {
    name_with_owner: String,
    url: String,
    description: Option<String>,
    visibility: Option<String>,
    default_branch_ref: Option<GithubBranchRef>,
}

#[derive(Debug, Deserialize)]
struct GithubBranchRef {
    name: Option<String>,
}

pub(crate) fn parse_repository(stdout: &[u8]) -> Option<RepositoryInfo> {
    let view = serde_json::from_slice::<GithubRepositoryView>(stdout).ok()?;
    if !has_host(&view.url, GITHUB_HOST) {
        return None;
    }
    let path = RepositoryPath::parse(RepositoryProvider::Github, &view.name_with_owner)?;
    let ssh_url = format!("git@{GITHUB_HOST}:{}.git", path.as_str());
    let https_url = format!("https://{GITHUB_HOST}/{}.git", path.as_str());
    Some(RepositoryInfo {
        provider: RepositoryProvider::Github,
        host: GITHUB_HOST.to_string(),
        full_path: path.as_str().to_string(),
        description: view.description.as_deref().and_then(bounded_description),
        visibility: parse_visibility(view.visibility.as_deref()),
        default_branch: view
            .default_branch_ref
            .and_then(|reference| reference.name)
            .as_deref()
            .and_then(bounded_branch),
        ssh_url: Some(ssh_url).filter(|url| is_ssh_clone_url(url)),
        https_url: Some(https_url).filter(|url| is_https_clone_url(url)),
    })
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
