use super::wire::RepositoryProvider;

pub(crate) const MAX_REPOSITORY_PATH_CHARS: usize = 255;

const GITHUB_SEGMENTS: (usize, usize) = (2, 2);
const GITLAB_SEGMENTS: (usize, usize) = (2, 20);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RepositoryPath(String);

impl RepositoryPath {
    pub(crate) fn parse(provider: RepositoryProvider, raw: &str) -> Option<Self> {
        normalized_repository_path(provider, raw).map(Self)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn percent_encoded(&self) -> String {
        percent_encode(&self.0)
    }
}

pub(crate) fn normalized_repository_path(
    provider: RepositoryProvider,
    raw: &str,
) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_REPOSITORY_PATH_CHARS {
        return None;
    }
    let path = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    if path.is_empty() {
        return None;
    }
    let segments = path.split('/').collect::<Vec<_>>();
    let (minimum, maximum) = segment_limits(provider);
    if segments.len() < minimum || segments.len() > maximum {
        return None;
    }
    if !segments.iter().all(|segment| is_path_segment(segment)) {
        return None;
    }
    Some(segments.join("/"))
}

pub(crate) fn is_normalized_repository_path(provider: RepositoryProvider, raw: &str) -> bool {
    normalized_repository_path(provider, raw).is_some_and(|normalized| normalized == raw)
}

fn segment_limits(provider: RepositoryProvider) -> (usize, usize) {
    match provider {
        RepositoryProvider::Github => GITHUB_SEGMENTS,
        RepositoryProvider::Gitlab => GITLAB_SEGMENTS,
    }
}

fn is_path_segment(segment: &str) -> bool {
    if segment.contains("..") {
        return false;
    }
    let mut bytes = segment.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-')
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 3);
    for byte in value.bytes() {
        if is_unreserved(byte) {
            encoded.push(char::from(byte));
            continue;
        }
        encoded.push('%');
        encoded.push(hex_digit(byte >> 4));
        encoded.push(hex_digit(byte & 0x0f));
    }
    encoded
}

fn is_unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-' || byte == b'~'
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => char::from(b'0' + value),
        _ => char::from(b'A' + value - 10),
    }
}
