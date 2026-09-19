//! Isolated, ephemeral HTML previews. Routes never resolve workspace paths.
//!
//! Registered schemes count as local in Tauri. Native IPC isolation therefore
//! relies on the opaque iframe sandbox, CSP connect-src none, and Tauri's random
//! invoke key (injected into the main frame only). Never grant allow-same-origin,
//! inject the key into previews, or forward their postMessage data into IPC.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    http::{Request, Response},
    Manager,
};

pub(crate) const SCHEME: &str = "codevo-artifact-preview";
const HTML_LIMIT: usize = 2 * 1024 * 1024;
const TOTAL_LIMIT: usize = 16 * 1024 * 1024;
const ENTRY_LIMIT: usize = 8;
const TTL: Duration = Duration::from_secs(30 * 60);
const CSP: &str = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'";
const UNAVAILABLE: &str = concat!(
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"color-scheme\" content=\"light dark\">",
    "<title>Preview unavailable</title></head>",
    "<body style=\"margin:0;min-height:100vh;display:flex;align-items:center;",
    "justify-content:center;background:Canvas;color:CanvasText;",
    "font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif\">",
    "<div style=\"max-width:22rem;padding:24px;text-align:center\">",
    "<p style=\"margin:0 0 6px;font-size:15px;font-weight:600\">",
    "This preview is no longer available</p>",
    "<p style=\"margin:0;opacity:.7\">It expired or was closed. ",
    "Close and reopen the file to show it again.</p>",
    "</div></body></html>"
);

struct Entry {
    html: Arc<[u8]>,
    created: Instant,
}
#[derive(Default)]
pub(crate) struct ArtifactPreviewState {
    entries: Mutex<HashMap<String, Entry>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateRequest {
    html: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RevokeRequest {
    token: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewHandle {
    token: String,
    url: String,
}

fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    // SAFETY: buffer is writable for its length and getentropy retains no pointer.
    if unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) } != 0 {
        return Err("Could not create preview identity.".into());
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn preview_url(token: &str) -> String {
    #[cfg(any(windows, target_os = "android"))]
    {
        format!("http://{SCHEME}.localhost/{token}")
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        format!("{SCHEME}://localhost/{token}")
    }
}
impl ArtifactPreviewState {
    fn create(&self, html: String, now: Instant) -> Result<PreviewHandle, String> {
        if html.is_empty() || html.len() > HTML_LIMIT || html.contains('\0') {
            return Err("HTML preview is empty, invalid, or exceeds 2 MiB.".into());
        }
        let bytes: Arc<[u8]> = html.into_bytes().into();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Preview registry unavailable.")?;
        entries.retain(|_, entry| now.saturating_duration_since(entry.created) < TTL);
        if entries.len() >= ENTRY_LIMIT
            || entries
                .values()
                .map(|entry| entry.html.len())
                .sum::<usize>()
                + bytes.len()
                > TOTAL_LIMIT
        {
            return Err("Too many open previews. Close a preview and try again.".into());
        }
        for _ in 0..4 {
            let id = token()?;
            if entries.contains_key(&id) {
                continue;
            }
            let url = preview_url(&id);
            entries.insert(
                id.clone(),
                Entry {
                    html: bytes,
                    created: now,
                },
            );
            return Ok(PreviewHandle { token: id, url });
        }
        Err("Could not create unique preview identity.".into())
    }
    fn revoke(&self, token: &str) -> Result<(), String> {
        if !valid_token(token) {
            return Err("Invalid preview identity.".into());
        }
        self.entries
            .lock()
            .map_err(|_| "Preview registry unavailable.")?
            .remove(token);
        Ok(())
    }
    fn read(&self, token: &str, now: Instant) -> Option<Arc<[u8]>> {
        if !valid_token(token) {
            return None;
        }
        let mut entries = self.entries.lock().ok()?;
        entries.retain(|_, entry| now.saturating_duration_since(entry.created) < TTL);
        entries.get(token).map(|entry| Arc::clone(&entry.html))
    }
}
#[tauri::command]
pub(crate) fn artifact_preview_create(
    webview: tauri::Webview,
    state: tauri::State<'_, ArtifactPreviewState>,
    request: CreateRequest,
) -> Result<PreviewHandle, String> {
    if webview.label() != "main" {
        return Err("Preview owner is unavailable.".into());
    }
    state.create(request.html, Instant::now())
}
#[tauri::command]
pub(crate) fn artifact_preview_revoke(
    webview: tauri::Webview,
    state: tauri::State<'_, ArtifactPreviewState>,
    request: RevokeRequest,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Preview owner is unavailable.".into());
    }
    state.revoke(&request.token)
}
fn request_token(request: &Request<Vec<u8>>) -> Option<&str> {
    let uri = request.uri();
    if request.method() != tauri::http::Method::GET || uri.query().is_some() {
        return None;
    }
    let valid_origin = (uri.scheme_str() == Some(SCHEME)
        && uri.authority().map(|a| a.as_str()) == Some("localhost"))
        || (uri.scheme_str() == Some("http")
            && uri.authority().map(|a| a.as_str()) == Some("codevo-artifact-preview.localhost"));
    if !valid_origin {
        return None;
    }
    let token = uri.path().strip_prefix('/')?;
    valid_token(token).then_some(token)
}
fn response(body: Option<Arc<[u8]>>) -> Response<Vec<u8>> {
    let (status, bytes) = match body {
        Some(html) => (200, html.to_vec()),
        None => (404, UNAVAILABLE.as_bytes().to_vec()),
    };
    let mut response = Response::new(bytes);
    *response.status_mut() = tauri::http::StatusCode::from_u16(status).unwrap();
    for (name, value) in [
        ("content-type", "text/html; charset=utf-8"),
        ("content-security-policy", CSP),
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        ("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()"),
    ] { response.headers_mut().insert(tauri::http::header::HeaderName::from_static(name), tauri::http::HeaderValue::from_static(value)); }
    response
}
pub(crate) fn respond(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let body = (context.webview_label() == "main")
        .then(|| request_token(&request))
        .flatten()
        .and_then(|id| {
            context
                .app_handle()
                .state::<ArtifactPreviewState>()
                .read(id, Instant::now())
        });
    response(body)
}
#[cfg(test)]
#[path = "artifact_preview_tests.rs"]
mod tests;
