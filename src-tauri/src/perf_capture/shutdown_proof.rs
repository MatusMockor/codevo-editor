use super::{
    error,
    result_submission::{publish_atomically, submitted_capture_outcome},
    valid_config_token, RUN_TOKEN_ENV,
};
use serde::Serialize;
use std::path::{Component, Path};

const SHUTDOWN_PATH_ENV: &str = env!("CODEVO_PERF_CAPTURE_SHUTDOWN_PATH");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownProof<'a> {
    schema_version: u8,
    state: &'static str,
    run_token: &'a str,
    pid: u32,
    pgid: i32,
    capture_outcome: &'a str,
}

pub(super) fn publish() -> Result<(), String> {
    let path = Path::new(SHUTDOWN_PATH_ENV);
    if !valid_config_token(RUN_TOKEN_ENV)
        || !path.is_absolute()
        || path.file_name().is_none_or(|name| name.is_empty())
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(error(
            "Performance capture shutdown proof is not configured.",
        ));
    }
    let pid = std::process::id();
    let pgid = unsafe { libc::getpgid(0) };
    if pgid <= 0 || u32::try_from(pgid).ok() != Some(pid) {
        return Err(error("Performance capture shutdown ownership was lost."));
    }
    let payload = serde_json::to_vec(&ShutdownProof {
        schema_version: 1,
        state: "runtime-shutdown-requested",
        run_token: RUN_TOKEN_ENV,
        pid,
        pgid,
        capture_outcome: submitted_capture_outcome().proof_label(),
    })
    .map_err(|_| error("Performance capture shutdown proof could not be encoded."))?;
    publish_atomically(path, &payload)
}
