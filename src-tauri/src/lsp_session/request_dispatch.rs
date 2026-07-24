use super::{
    write_with_session_stdin, JsonRpcNotification, JsonRpcRequest, LanguageServerRequestError,
    LanguageServerSupervisor, PendingRequests,
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

pub(super) fn send_request_with_timeout(
    supervisor: &LanguageServerSupervisor,
    method: &str,
    params: Value,
    request_id: Option<u64>,
    timeout: Duration,
) -> Result<Option<Value>, LanguageServerRequestError> {
    if !matches!(
        supervisor.status(),
        super::LanguageServerRuntimeStatus::Running { .. }
    ) {
        return Ok(None);
    }

    let Some((stdin, pending_requests)) = supervisor.session_request_parts() else {
        return Ok(None);
    };
    let id =
        request_id.unwrap_or_else(|| supervisor.next_request_id.fetch_add(1, Ordering::SeqCst));
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id,
        method: method.to_string(),
        params,
    };
    let bytes = serde_json::to_vec(&request).map_err(|error| {
        LanguageServerRequestError::from(format!("Failed to serialize LSP request: {error}"))
    })?;
    let (tx, rx) = mpsc::channel();

    {
        let mut pending = pending_requests
            .lock()
            .map_err(|error| LanguageServerRequestError::from(error.to_string()))?;
        if pending.contains_key(&id) {
            return Err(LanguageServerRequestError::from(
                "Language server request id is already pending.",
            ));
        }
        pending.insert(id, tx);
    }

    let started_at = Instant::now();

    if let Err(error) = write_with_session_stdin(&stdin, &bytes) {
        remove_pending_request(&pending_requests, id);
        supervisor.record_request_outcome(method, started_at, false);
        return Err(LanguageServerRequestError::from(format!(
            "Failed to send LSP request `{method}`: {error}"
        )));
    }

    match rx.recv_timeout(timeout) {
        Ok(Ok(result)) => {
            supervisor.record_request_outcome(method, started_at, true);
            Ok(Some(result))
        }
        Ok(Err(message)) => {
            supervisor.record_request_outcome(method, started_at, false);
            Err(message)
        }
        Err(RecvTimeoutError::Timeout) => {
            remove_pending_request(&pending_requests, id);
            supervisor.record_request_outcome(method, started_at, false);
            Err(LanguageServerRequestError::from(format!(
                "Language server request `{method}` timed out."
            )))
        }
        Err(RecvTimeoutError::Disconnected) => {
            supervisor.record_request_outcome(method, started_at, false);
            Err(LanguageServerRequestError::from(format!(
                "Language server request `{method}` was cancelled."
            )))
        }
    }
}

pub(super) fn cancel_pending_request(supervisor: &LanguageServerSupervisor, request_id: u64) {
    let Some((stdin, pending_requests)) = supervisor.session_request_parts() else {
        return;
    };
    let still_pending = {
        let Ok(pending) = pending_requests.lock() else {
            return;
        };
        pending.contains_key(&request_id)
    };
    if !still_pending {
        return;
    }
    let notification = JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "$/cancelRequest".to_string(),
        params: json!({ "id": request_id }),
    };
    let Ok(bytes) = serde_json::to_vec(&notification) else {
        return;
    };
    let _ = write_with_session_stdin(&stdin, &bytes);
}

fn remove_pending_request(pending_requests: &PendingRequests, id: u64) {
    let Ok(mut pending) = pending_requests.lock() else {
        return;
    };
    pending.remove(&id);
}
