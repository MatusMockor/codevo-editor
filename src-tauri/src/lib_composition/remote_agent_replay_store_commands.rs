use crate::run_blocking_command;
use remote_agent_replay_store::wire::{
    validate_identifier, validate_key, validate_put_request, ClearRequest, LoadThreadRequest,
    LoadThreadResponse, PutTaskRequest, PutTaskResponse, RemoveResponse, RemoveServerRequest,
    RemoveThreadRequest,
};
use remote_agent_replay_store::RemoteAgentReplayStore;
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[path = "../remote_agent_replay_store/mod.rs"]
pub(crate) mod remote_agent_replay_store;

fn now_ms() -> Option<i64> {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(elapsed.as_millis()).ok()
}

async fn dispatch<T: Send + 'static>(fallback: T, work: impl FnOnce() -> T + Send + 'static) -> T {
    run_blocking_command(move || Ok(work()))
        .await
        .unwrap_or(fallback)
}

#[tauri::command]
pub(crate) async fn remote_replay_cache_load_thread(
    request: LoadThreadRequest,
    store: State<'_, Arc<RemoteAgentReplayStore>>,
) -> Result<LoadThreadResponse, ()> {
    if validate_key(&request.key).is_err() {
        return Ok(LoadThreadResponse::Miss {});
    }
    let store = Arc::clone(&store);
    Ok(dispatch(LoadThreadResponse::Miss {}, move || {
        let Some(now_ms) = now_ms() else {
            return LoadThreadResponse::Miss {};
        };
        store
            .load_thread(&request.key, now_ms)
            .unwrap_or(LoadThreadResponse::Miss {})
    })
    .await)
}

#[tauri::command]
pub(crate) async fn remote_replay_cache_put_task(
    request: PutTaskRequest,
    store: State<'_, Arc<RemoteAgentReplayStore>>,
) -> Result<PutTaskResponse, ()> {
    if let Err(reason) = validate_put_request(&request) {
        return Ok(PutTaskResponse::Rejected { reason });
    }
    let store = Arc::clone(&store);
    Ok(dispatch(PutTaskResponse::Unavailable {}, move || {
        let Some(now_ms) = now_ms() else {
            return PutTaskResponse::Unavailable {};
        };
        store
            .put_task(
                &request.key,
                &request.task_id,
                request.record.as_bytes(),
                now_ms,
            )
            .unwrap_or(PutTaskResponse::Unavailable {})
    })
    .await)
}

#[tauri::command]
pub(crate) async fn remote_replay_cache_remove_thread(
    request: RemoveThreadRequest,
    store: State<'_, Arc<RemoteAgentReplayStore>>,
) -> Result<RemoveResponse, ()> {
    if validate_key(&request.key).is_err() {
        return Ok(RemoveResponse::Unavailable {});
    }
    let store = Arc::clone(&store);
    Ok(dispatch(RemoveResponse::Unavailable {}, move || {
        removed(store.remove_thread(&request.key))
    })
    .await)
}

#[tauri::command]
pub(crate) async fn remote_replay_cache_remove_server(
    request: RemoveServerRequest,
    store: State<'_, Arc<RemoteAgentReplayStore>>,
) -> Result<RemoveResponse, ()> {
    if validate_identifier(&request.server_id).is_err() {
        return Ok(RemoveResponse::Unavailable {});
    }
    let store = Arc::clone(&store);
    Ok(dispatch(RemoveResponse::Unavailable {}, move || {
        removed(store.remove_server(&request.server_id))
    })
    .await)
}

#[tauri::command]
pub(crate) async fn remote_replay_cache_clear(
    request: ClearRequest,
    store: State<'_, Arc<RemoteAgentReplayStore>>,
) -> Result<RemoveResponse, ()> {
    let ClearRequest {} = request;
    let store = Arc::clone(&store);
    Ok(dispatch(RemoveResponse::Unavailable {}, move || {
        removed(store.clear())
    })
    .await)
}

fn removed(result: remote_agent_replay_store::CacheResult<()>) -> RemoveResponse {
    match result {
        Ok(()) => RemoveResponse::Removed {},
        Err(_) => RemoveResponse::Unavailable {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use remote_agent_replay_store::CacheError;

    #[test]
    fn storage_failures_have_closed_responses() {
        for error in [
            CacheError::Busy,
            CacheError::Unavailable,
            CacheError::Corrupt,
            CacheError::InvalidIdentifier,
        ] {
            assert_eq!(removed(Err(error)), RemoveResponse::Unavailable {});
        }
        assert_eq!(removed(Ok(())), RemoveResponse::Removed {});
    }

    #[test]
    fn blocking_dispatch_returns_the_closed_result() {
        let response =
            tauri::async_runtime::block_on(dispatch(PutTaskResponse::Unavailable {}, || {
                PutTaskResponse::Stored {}
            }));
        assert_eq!(response, PutTaskResponse::Stored {});
    }

    #[test]
    fn a_failed_blocking_task_returns_the_fallback() {
        let response =
            tauri::async_runtime::block_on(dispatch(LoadThreadResponse::Miss {}, || {
                panic!("failed cache worker")
            }));
        assert_eq!(response, LoadThreadResponse::Miss {});
    }
}
