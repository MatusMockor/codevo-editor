use super::transport::{CdpClient, CdpShared};
use serde_json::json;
use std::sync::{Arc, Mutex};

/// DAP Disconnect detaches an attached target while allowing it to continue.
/// Commands are best effort because either can be a no-op/error when the
/// target is already running or the inspector peer closed concurrently.
pub(super) fn continue_and_close(client: &mut CdpClient, shared: &Arc<Mutex<CdpShared>>) {
    let _ = client.request("Runtime.runIfWaitingForDebugger", json!({}));
    let _ = client.request("Debugger.resume", json!({}));
    if let Ok(mut shared) = shared.lock() {
        shared.pending_restart_frame = None;
        shared.invalidate_pause();
    }
    client.shutdown();
}
