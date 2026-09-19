use super::wire::is_repository_host;

const MAX_CLONE_URL_BYTES: usize = 2048;

pub(crate) fn clone_url_host(value: &str) -> Option<String> {
    if value.len() > MAX_CLONE_URL_BYTES || !value.is_ascii() {
        return None;
    }
    let authority = clone_url_authority(value)?;
    let after_user = authority
        .split_once('@')
        .map_or(authority, |(_, host)| host);
    let host = after_user
        .split_once(':')
        .map_or(after_user, |(host, _)| host);
    let lowered = host.to_ascii_lowercase();
    if !is_repository_host(&lowered) {
        return None;
    }
    Some(lowered)
}

pub(crate) fn has_host(value: &str, host: &str) -> bool {
    clone_url_host(value).is_some_and(|candidate| candidate == host)
}

fn clone_url_authority(value: &str) -> Option<&str> {
    if let Some(rest) = value.strip_prefix("https://") {
        return rest.split_once('/').map(|(authority, _)| authority);
    }
    if let Some(rest) = value.strip_prefix("ssh://") {
        return rest.split_once('/').map(|(authority, _)| authority);
    }
    value.split_once(':').map(|(authority, _)| authority)
}
