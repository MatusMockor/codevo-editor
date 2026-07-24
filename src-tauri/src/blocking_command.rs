/// Runs a blocking command body on Tokio's dedicated blocking pool so the Tauri
/// WebView main thread is never stalled by file-system, tree-sitter, or SQLite
/// work — the same off-main-thread discipline used by the LSP feature commands
/// (`LanguageServerRegistry::send_request_async`).
///
/// The closure must own everything it touches (`'static`); callers capture and
/// clone their arguments before handing the work off, so nothing borrows across
/// the `await` and per-workspace isolation is decided by the captured values.
pub(crate) async fn run_blocking_command<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Command task failed: {error}"))?
}
