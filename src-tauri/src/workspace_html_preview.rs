//! Immutable, bounded web assets captured from an exact registered workspace.
//! Only explicit web-asset references are read; routes never access the filesystem.
use crate::{
    artifact_preview::{ArtifactPreviewState, PreviewAsset, PreviewHandle, HTML_LIMIT},
    workspace_registry::{
        open_file_relative_to, ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry,
    },
};
use serde::Deserialize;
use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    io::Read,
    os::unix::fs::MetadataExt,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

#[path = "workspace_html_preview/html_scopes.rs"]
mod html_scopes;

const ASSET_LIMIT: usize = 128;
const BUNDLE_LIMIT: usize = 16 * 1024 * 1024;
const DEPTH_LIMIT: usize = 8;
const DEADLINE: Duration = Duration::from_secs(5);
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
struct Permit;
impl Permit {
    fn acquire() -> Result<Self, String> {
        ACTIVE
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < 2).then_some(n + 1)
            })
            .map(|_| Self)
            .map_err(|_| "Two HTML previews are already being prepared.".into())
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRequest {
    workspace_id: String,
    relative_path: String,
    html: String,
}
fn validate(request: &CreateRequest) -> Result<(), String> {
    if request.workspace_id.is_empty()
        || request.workspace_id.len() > 1024
        || request.workspace_id.contains('\0')
    {
        return Err("Invalid HTML preview workspace.".into());
    }
    if decode_asset_path(&request.relative_path).as_deref() != Some(request.relative_path.as_str())
        || !matches!(
            Path::new(&request.relative_path)
                .extension()
                .and_then(|v| v.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("html" | "htm")
        )
    {
        return Err("Select a workspace HTML file to preview.".into());
    }
    if request.html.is_empty() || request.html.len() > HTML_LIMIT || request.html.contains('\0') {
        return Err("HTML preview is empty, invalid, or exceeds 2 MiB.".into());
    }
    Ok(())
}

/// Decodes URL paths once, rejecting separators and traversal aliases.
pub(crate) fn decode_asset_path(path: &str) -> Option<String> {
    if path.is_empty() || path.len() > 4096 {
        return None;
    }
    let mut bytes = Vec::with_capacity(path.len());
    let mut source = path.bytes();
    while let Some(byte) = source.next() {
        if byte == b'%' {
            let a = char::from(source.next()?).to_digit(16)?;
            let b = char::from(source.next()?).to_digit(16)?;
            let byte = (a * 16 + b) as u8;
            if matches!(byte, b'/' | b'\\' | b'%' | 0) {
                return None;
            }
            bytes.push(byte);
        } else {
            bytes.push(byte);
        }
    }
    let decoded = String::from_utf8(bytes).ok()?;
    if decoded.contains(['\\', '\0', ':', '?', '#'])
        || decoded.chars().any(char::is_control)
        || decoded
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p.starts_with('.'))
    {
        return None;
    }
    Some(decoded)
}
fn mime(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "css" => Some("text/css; charset=utf-8"),
        "js" | "mjs" => Some("text/javascript; charset=utf-8"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        _ => None,
    }
}
fn reference_path(base: &str, reference: &str) -> Option<String> {
    let reference = reference.trim().split(['?', '#']).next()?;
    if reference.is_empty() || reference.starts_with('/') || reference.contains([':', '\\', '&']) {
        return None;
    }
    let mut parts: Vec<&str> = base
        .rsplit_once('/')
        .map(|(p, _)| p.split('/').collect())
        .unwrap_or_default();
    for part in reference.split('/') {
        match part {
            "." => {}
            ".." => {
                parts.pop()?;
            }
            "" => return None,
            p => parts.push(p),
        }
    }
    let path = decode_asset_path(&parts.join("/"))?;
    mime(&path)?;
    Some(path)
}
static ATTRIBUTES: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(
        r#"([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#,
    )
    .expect("constant HTML attributes")
});
static CSS_URLS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(
        r#"(?is)/\*.*?\*/|url\(\s*["']?([^\s"')]+)["']?\s*\)|@import\s*["']([^"']+)["']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'"#,
    )
    .expect("constant CSS URLs")
});
fn reference_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    if text.starts_with('<') {
        let mut ranges = Vec::new();
        for capture in ATTRIBUTES.captures_iter(text) {
            let name = &capture[1];
            let Some(value) = capture.iter().skip(2).flatten().next() else {
                continue;
            };
            if name.eq_ignore_ascii_case("src") || name.eq_ignore_ascii_case("href") {
                ranges.push(value.range());
            } else if name.eq_ignore_ascii_case("style") {
                ranges.extend(
                    css_ranges(value.as_str())
                        .into_iter()
                        .map(|range| (range.start + value.start())..(range.end + value.start())),
                );
            }
        }
        ranges
    } else {
        css_ranges(text)
    }
}
fn css_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    CSS_URLS
        .captures_iter(text)
        .filter_map(|capture| {
            capture
                .iter()
                .skip(1)
                .flatten()
                .next()
                .map(|value| value.range())
        })
        .collect()
}
fn references(text: &str, base: &str) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for range in reference_ranges(text) {
        if let Some(path) = reference_path(base, &text[range]) {
            if result.len() == ASSET_LIMIT {
                return Err("HTML preview references more than 128 assets.".into());
            }
            result.push(path);
        }
    }
    Ok(result)
}
fn unchanged(file: &File, before: &std::fs::Metadata) -> bool {
    file.metadata().is_ok_and(|after| {
        before.dev() == after.dev()
            && before.ino() == after.ino()
            && before.len() == after.len()
            && before.mtime() == after.mtime()
            && before.mtime_nsec() == after.mtime_nsec()
            && before.ctime() == after.ctime()
            && before.ctime_nsec() == after.ctime_nsec()
    })
}
fn same_root(a: &File, b: &File) -> Result<bool, String> {
    let a = a
        .metadata()
        .map_err(|_| "Workspace identity unavailable.")?;
    let b = b
        .metadata()
        .map_err(|_| "Workspace identity unavailable.")?;
    Ok(a.dev() == b.dev() && a.ino() == b.ino())
}
fn check_owner(
    registry: &WorkspaceRegistry,
    descriptor: &ManagedWorkspaceDescriptor,
    root: &File,
) -> Result<(), String> {
    if registry
        .descriptor(&descriptor.workspace_id)
        .map_err(|_| "Preview workspace closed.")?
        != *descriptor
        || !same_root(
            root,
            &registry
                .clone_root(&descriptor.workspace_id)
                .map_err(|_| "Preview workspace closed.")?,
        )?
        || !same_root(
            root,
            &File::open(&descriptor.canonical_root_path).map_err(|_| "Preview workspace moved.")?,
        )?
    {
        return Err("Preview workspace changed. Reopen the file.".into());
    }
    Ok(())
}
fn snapshot(
    root: &File,
    relative_path: &str,
    html: &str,
) -> Result<(String, HashMap<String, PreviewAsset>), String> {
    let start = Instant::now();
    let document = open_file_relative_to(root, Path::new(relative_path))
        .map_err(|_| "HTML file is no longer available.")?;
    let document_identity = document
        .metadata()
        .map_err(|_| "HTML file is no longer available.")?;
    let scopes = html_scopes::scopes(html)?;
    let mut queue = VecDeque::new();
    for scope in &scopes {
        for path in references(&html[scope.clone()], relative_path)? {
            if queue.len() >= ASSET_LIMIT {
                return Err("HTML preview references more than 128 assets.".into());
            }
            queue.push_back((path, 0));
        }
    }
    let mut assets = HashMap::new();
    let mut bytes = html.len();
    while let Some((path, depth)) = queue.pop_front() {
        if assets.contains_key(&path) {
            continue;
        }
        if assets.len() >= ASSET_LIMIT || depth > DEPTH_LIMIT || start.elapsed() > DEADLINE {
            return Err("HTML preview asset count, nesting, or time limit exceeded.".into());
        }
        let file = open_file_relative_to(root, Path::new(&path))
            .map_err(|_| "A relative HTML preview asset is missing or unsafe.")?;
        let before = file
            .metadata()
            .map_err(|_| "HTML preview asset unavailable.")?;
        if before.nlink() != 1 || before.len() > HTML_LIMIT as u64 {
            return Err("HTML preview asset is unsafe or exceeds 2 MiB.".into());
        }
        let mut body = Vec::new();
        (&file)
            .take((HTML_LIMIT + 1) as u64)
            .read_to_end(&mut body)
            .map_err(|_| "HTML preview asset could not be read.")?;
        bytes += body.len();
        if body.len() > HTML_LIMIT || bytes > BUNDLE_LIMIT || !unchanged(&file, &before) {
            return Err("HTML preview assets changed or exceed 16 MiB.".into());
        }
        let content_type = mime(&path).ok_or("Unsupported HTML preview asset.")?;
        if content_type.starts_with("text/css") {
            let text =
                std::str::from_utf8(&body).map_err(|_| "HTML preview stylesheet must be UTF-8.")?;
            for next in references(text, &path)? {
                if queue.len() >= ASSET_LIMIT {
                    return Err("HTML preview references more than 128 assets.".into());
                }
                queue.push_back((next, depth + 1));
            }
        }
        assets.insert(
            path,
            PreviewAsset {
                bytes: Arc::from(body),
                mime: content_type,
            },
        );
    }
    let current = open_file_relative_to(root, Path::new(relative_path))
        .map_err(|_| "HTML file changed during preview.")?;
    if !unchanged(&document, &document_identity)
        || !same_root(&document, &current)?
        || start.elapsed() > DEADLINE
    {
        return Err("HTML file changed during preview. Try again.".into());
    }
    let mut rewritten = String::with_capacity(html.len());
    let mut previous = 0;
    for scope in scopes {
        rewritten.push_str(&html[previous..scope.start]);
        let region = &html[scope.clone()];
        let mut cursor = 0;
        for range in reference_ranges(region) {
            let value = &region[range.clone()];
            let Some(path) = reference_path(relative_path, value) else {
                continue;
            };
            rewritten.push_str(&region[cursor..range.start]);
            rewritten.push_str("./");
            for byte in path.bytes() {
                if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.') {
                    rewritten.push(char::from(byte));
                } else {
                    rewritten.push_str(&format!("%{byte:02X}"));
                }
            }
            if let Some(index) = value.find(['?', '#']) {
                rewritten.push_str(&value[index..]);
            }
            cursor = range.end;
        }
        rewritten.push_str(&region[cursor..]);
        previous = scope.end;
    }
    rewritten.push_str(&html[previous..]);
    if rewritten.len() > HTML_LIMIT
        || bytes - html.len() + rewritten.len() > BUNDLE_LIMIT
        || start.elapsed() > DEADLINE
    {
        return Err("Rewritten HTML preview exceeds 2 MiB.".into());
    }
    Ok((rewritten, assets))
}
#[tauri::command]
pub(crate) async fn workspace_html_preview_create(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    request: CreateRequest,
) -> Result<PreviewHandle, String> {
    if webview.label() != "main" {
        return Err("Preview owner unavailable.".into());
    }
    validate(&request)?;
    let permit = Permit::acquire()?;
    let registry = app.state::<WorkspaceRegistry>();
    let id: WorkspaceId =
        serde_json::from_value(serde_json::Value::String(request.workspace_id.clone()))
            .map_err(|_| "Invalid workspace identity.")?;
    let descriptor = registry
        .descriptor(&id)
        .map_err(|_| "Preview workspace unavailable.")?;
    let root = registry
        .clone_root(&id)
        .map_err(|_| "Preview workspace unavailable.")?;
    check_owner(&registry, &descriptor, &root)?;
    let worker_app = app.clone();
    let worker_root = root.try_clone().map_err(|_| "Workspace unavailable.")?;
    let worker_descriptor = descriptor.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let (html, assets) = snapshot(&worker_root, &request.relative_path, &request.html)?;
        check_owner(
            &worker_app.state::<WorkspaceRegistry>(),
            &worker_descriptor,
            &worker_root,
        )?;
        worker_app
            .state::<ArtifactPreviewState>()
            .create_bundle(html, assets, Instant::now(), true)
    })
    .await
    .map_err(|_| "HTML preview preparation failed.")??;
    if let Err(error) = check_owner(&app.state::<WorkspaceRegistry>(), &descriptor, &root) {
        app.state::<ArtifactPreviewState>().revoke(&handle.token)?;
        return Err(error);
    }
    Ok(handle)
}
#[cfg(test)]
#[path = "workspace_html_preview_tests.rs"]
mod tests;
