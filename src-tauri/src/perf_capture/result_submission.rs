use super::{compile_time_config, error, tokens_equal, CaptureConfig};
use serde::Deserialize;
use serde_json::Value;
#[cfg(not(unix))]
use std::fs::{self, OpenOptions};
use std::{
    fs::File,
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, AtomicU8, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
const SUBMISSION_IDLE: u8 = 0;
const SUBMISSION_PROCESSING: u8 = 1;
const SUBMISSION_DONE: u8 = 2;
static SUBMISSION_STATE: AtomicU8 = AtomicU8::new(SUBMISSION_IDLE);
const CAPTURE_OUTCOME_NONE: u8 = 0;
const CAPTURE_OUTCOME_ERROR: u8 = 1;
const CAPTURE_OUTCOME_OTHER: u8 = 2;
static CAPTURE_OUTCOME: AtomicU8 = AtomicU8::new(CAPTURE_OUTCOME_NONE);
static TEMPORARY_NONCE: AtomicU64 = AtomicU64::new(0);
const MAX_ERROR_MESSAGE_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SubmittedCaptureOutcome {
    None,
    Error,
    Other,
}

impl SubmittedCaptureOutcome {
    pub(super) const fn proof_label(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Error => "error",
            Self::Other => "other",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClosedErrorEnvelope {
    status: ErrorStatus,
    message: String,
}

#[derive(Deserialize)]
enum ErrorStatus {
    #[serde(rename = "error")]
    Error,
}

pub(super) async fn submit(payload: String, run_token: String) -> Result<(), String> {
    let config = compile_time_config()?;
    claim_submission(&SUBMISSION_STATE)?;

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        process_claimed_submission(
            &SUBMISSION_STATE,
            &CAPTURE_OUTCOME,
            &config,
            &payload,
            &run_token,
        )
    })
    .await;

    finish_worker_outcome(&SUBMISSION_STATE, outcome.map_err(|_| ()))
}

fn finish_worker_outcome(
    state: &AtomicU8,
    outcome: Result<Result<(), String>, ()>,
) -> Result<(), String> {
    match outcome {
        Ok(result) => result,
        Err(()) => {
            state.store(SUBMISSION_DONE, Ordering::Release);
            Err(error("Performance capture worker failed."))
        }
    }
}

#[cfg(test)]
fn submit_once(
    state: &AtomicU8,
    capture_outcome: &AtomicU8,
    config: &CaptureConfig,
    payload: &str,
    candidate_token: &str,
) -> Result<(), String> {
    claim_submission(state)?;
    process_claimed_submission(state, capture_outcome, config, payload, candidate_token)
}

fn claim_submission(state: &AtomicU8) -> Result<(), String> {
    state
        .compare_exchange(
            SUBMISSION_IDLE,
            SUBMISSION_PROCESSING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .map(|_| ())
        .map_err(|observed| {
            if observed == SUBMISSION_PROCESSING {
                error("Performance capture submission is already in progress.")
            } else {
                error("Performance capture was already submitted.")
            }
        })
}

fn process_claimed_submission(
    state: &AtomicU8,
    capture_outcome: &AtomicU8,
    config: &CaptureConfig,
    payload: &str,
    candidate_token: &str,
) -> Result<(), String> {
    if let Err(validation_error) = validate_submission(config, payload, candidate_token) {
        state.store(SUBMISSION_IDLE, Ordering::Release);
        return Err(validation_error);
    }

    let result = publish_atomically(&config.result_path, payload.as_bytes());
    if result.is_ok() {
        capture_outcome.store(classify_capture_outcome(payload), Ordering::Release);
    }
    state.store(SUBMISSION_DONE, Ordering::Release);
    result
}

fn classify_capture_outcome(payload: &str) -> u8 {
    match serde_json::from_str::<ClosedErrorEnvelope>(payload) {
        Ok(envelope)
            if matches!(envelope.status, ErrorStatus::Error)
                && !envelope.message.is_empty()
                && envelope.message.len() <= MAX_ERROR_MESSAGE_BYTES =>
        {
            CAPTURE_OUTCOME_ERROR
        }
        _ => CAPTURE_OUTCOME_OTHER,
    }
}

pub(super) fn submitted_capture_outcome() -> SubmittedCaptureOutcome {
    match CAPTURE_OUTCOME.load(Ordering::Acquire) {
        CAPTURE_OUTCOME_ERROR => SubmittedCaptureOutcome::Error,
        CAPTURE_OUTCOME_OTHER => SubmittedCaptureOutcome::Other,
        _ => SubmittedCaptureOutcome::None,
    }
}

fn validate_submission(
    config: &CaptureConfig,
    payload: &str,
    candidate_token: &str,
) -> Result<(), String> {
    if !tokens_equal(candidate_token.as_bytes(), config.run_token.as_bytes()) {
        return Err(error("Performance capture token was rejected."));
    }

    if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
        return Err(error("Performance capture payload size was rejected."));
    }

    let parsed: Value = serde_json::from_str(payload)
        .map_err(|_| error("Performance capture payload is not valid JSON."))?;
    if !parsed.is_object() {
        return Err(error("Performance capture payload must be a JSON object."));
    }

    Ok(())
}

#[cfg(unix)]
pub(super) fn publish_atomically(result_path: &Path, payload: &[u8]) -> Result<(), String> {
    use std::{
        ffi::CString,
        os::fd::{AsRawFd, FromRawFd},
        os::unix::{ffi::OsStrExt, fs::MetadataExt},
    };

    let parent = result_path
        .parent()
        .filter(|parent| parent.is_absolute())
        .ok_or_else(|| error("Performance capture output is unavailable."))?;
    let parent_bytes = parent.as_os_str().as_bytes();
    let parent_c = CString::new(parent_bytes)
        .map_err(|_| error("Performance capture output is unavailable."))?;
    let parent_fd = unsafe {
        libc::open(
            parent_c.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if parent_fd < 0 {
        return Err(error("Performance capture output is unavailable."));
    }
    let directory = unsafe { File::from_raw_fd(parent_fd) };
    let metadata = directory
        .metadata()
        .map_err(|_| error("Performance capture output is unavailable."))?;
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
    {
        return Err(error("Performance capture output is unavailable."));
    }

    let result_name = result_path
        .file_name()
        .ok_or_else(|| error("Performance capture output is unavailable."))?;
    let result_name_c = CString::new(result_name.as_bytes())
        .map_err(|_| error("Performance capture output is unavailable."))?;
    let temporary_name = temporary_name_for(result_name)?;
    let temporary_name_c = CString::new(temporary_name.as_bytes())
        .map_err(|_| error("Performance capture output is unavailable."))?;
    let temporary_fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            temporary_name_c.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600,
        )
    };
    if temporary_fd < 0 {
        return Err(error("Performance capture output could not be created."));
    }
    let mut temporary = unsafe { File::from_raw_fd(temporary_fd) };

    let write_result = (|| {
        temporary
            .write_all(payload)
            .map_err(|_| error("Performance capture output could not be written."))?;
        temporary
            .sync_all()
            .map_err(|_| error("Performance capture output could not be written."))?;
        let linked = unsafe {
            libc::linkat(
                directory.as_raw_fd(),
                temporary_name_c.as_ptr(),
                directory.as_raw_fd(),
                result_name_c.as_ptr(),
                0,
            )
        };
        if linked != 0 {
            return Err(error("Performance capture output could not be published."));
        }
        Ok(())
    })();

    drop(temporary);
    let unlinked = unsafe { libc::unlinkat(directory.as_raw_fd(), temporary_name_c.as_ptr(), 0) };
    write_result?;
    if unlinked != 0 {
        return Err(error(
            "Performance capture output cleanup could not be confirmed.",
        ));
    }
    directory
        .sync_all()
        .map_err(|_| error("Performance capture output could not be published."))
}

#[cfg(not(unix))]
fn publish_atomically(result_path: &Path, payload: &[u8]) -> Result<(), String> {
    let parent = result_path
        .parent()
        .filter(|parent| parent.is_absolute())
        .ok_or_else(|| error("Performance capture output is unavailable."))?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|_| error("Performance capture output is unavailable."))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(error("Performance capture output is unavailable."));
    }

    let temporary_name = temporary_name_for(
        result_path
            .file_name()
            .ok_or_else(|| error("Performance capture output is unavailable."))?,
    )?;
    let temporary_path = result_path.with_file_name(temporary_name);
    let mut temporary = create_private_file(&temporary_path)
        .map_err(|_| error("Performance capture output could not be created."))?;

    let write_result = (|| {
        temporary
            .write_all(payload)
            .map_err(|_| error("Performance capture output could not be written."))?;
        temporary
            .sync_all()
            .map_err(|_| error("Performance capture output could not be written."))?;
        fs::hard_link(&temporary_path, result_path)
            .map_err(|_| error("Performance capture output could not be published."))?;
        Ok(())
    })();

    drop(temporary);
    let cleanup_result = fs::remove_file(&temporary_path);
    write_result?;
    cleanup_result
        .map_err(|_| error("Performance capture output cleanup could not be confirmed."))?;
    sync_parent(parent)
}

fn temporary_name_for(file_name: &std::ffi::OsStr) -> Result<String, String> {
    let file_name = file_name
        .to_str()
        .ok_or_else(|| error("Performance capture output is unavailable."))?;
    let clock_nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_nonce = TEMPORARY_NONCE.fetch_add(1, Ordering::Relaxed);
    Ok(format!(
        ".{file_name}.{}-{clock_nonce}-{process_nonce}.tmp",
        std::process::id()
    ))
}

#[cfg(not(unix))]
fn create_private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options.open(path)
}

#[cfg(not(unix))]
fn sync_parent(parent: &Path) -> Result<(), String> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| error("Performance capture output could not be published."))
}

#[cfg(test)]
pub(super) fn reset_submission_for_test() {
    SUBMISSION_STATE.store(SUBMISSION_IDLE, Ordering::Release);
    CAPTURE_OUTCOME.store(CAPTURE_OUTCOME_NONE, Ordering::Release);
}

#[cfg(test)]
pub(super) fn submission_state_for_test() -> u8 {
    SUBMISSION_STATE.load(Ordering::Acquire)
}

#[cfg(test)]
mod tests {
    use super::super::{valid_config_token, valid_result_path};
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::{Arc, Barrier},
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    struct ScratchDirectory(PathBuf);

    impl ScratchDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "codevo-perf-capture-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create scratch directory");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                    .expect("make scratch directory private");
            }
            Self(path)
        }

        fn output(&self) -> PathBuf {
            self.0.join("result.json")
        }
    }

    impl Drop for ScratchDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn config(path: PathBuf) -> CaptureConfig {
        CaptureConfig {
            result_path: path,
            run_token: TOKEN.to_owned(),
        }
    }

    #[test]
    fn publishes_exact_payload_once_without_a_temporary_residue() {
        let scratch = ScratchDirectory::new("success");
        let output = scratch.output();
        let submitted = AtomicU8::new(SUBMISSION_IDLE);
        let capture_outcome = AtomicU8::new(CAPTURE_OUTCOME_NONE);
        let payload = r#"{"status":"ok","result":{"samples":[1,2,3]}}"#;

        submit_once(
            &submitted,
            &capture_outcome,
            &config(output.clone()),
            payload,
            TOKEN,
        )
        .expect("submit capture");

        assert_eq!(fs::read_to_string(&output).expect("read result"), payload);
        assert_eq!(fs::read_dir(&scratch.0).expect("read scratch").count(), 1);
        assert_eq!(
            capture_outcome.load(Ordering::Acquire),
            CAPTURE_OUTCOME_OTHER
        );
        assert_eq!(
            submit_once(
                &submitted,
                &capture_outcome,
                &config(output),
                payload,
                TOKEN,
            ),
            Err("Performance capture was already submitted.".to_owned())
        );
    }

    #[test]
    fn only_a_closed_bounded_error_envelope_gets_early_failure_authority() {
        assert_eq!(
            classify_capture_outcome(r#"{"status":"error","message":"window did not activate"}"#),
            CAPTURE_OUTCOME_ERROR
        );
        for payload in [
            r#"{"status":"ok","result":{}}"#,
            r#"{"status":"error","message":"failure","extra":true}"#,
            r#"{"status":"ok","status":"error","message":"failure"}"#,
            r#"{"message":"failure","status":"error","message":"replaced"}"#,
            r#"{"status":"error","message":""}"#,
            r#"{"status":"error"}"#,
        ] {
            assert_eq!(
                classify_capture_outcome(payload),
                CAPTURE_OUTCOME_OTHER,
                "payload must fail closed: {payload}"
            );
        }
        let oversized = format!(
            r#"{{"status":"error","message":"{}"}}"#,
            "x".repeat(MAX_ERROR_MESSAGE_BYTES + 1)
        );
        assert_eq!(classify_capture_outcome(&oversized), CAPTURE_OUTCOME_OTHER);
    }

    #[test]
    fn rejects_wrong_token_and_invalid_payload_without_consuming_the_slot() {
        let scratch = ScratchDirectory::new("validation");
        let output = scratch.output();
        let submitted = AtomicU8::new(SUBMISSION_IDLE);
        let capture_outcome = AtomicU8::new(CAPTURE_OUTCOME_NONE);
        let capture = config(output.clone());

        assert_eq!(
            submit_once(&submitted, &capture_outcome, &capture, "{}", "wrong"),
            Err("Performance capture token was rejected.".to_owned())
        );
        assert_eq!(
            submit_once(&submitted, &capture_outcome, &capture, "[]", TOKEN),
            Err("Performance capture payload must be a JSON object.".to_owned())
        );
        assert_eq!(submitted.load(Ordering::Acquire), SUBMISSION_IDLE);

        submit_once(&submitted, &capture_outcome, &capture, "{}", TOKEN).expect("valid retry");
        assert_eq!(fs::read_to_string(output).expect("read result"), "{}");
    }

    #[test]
    fn rejects_payload_over_the_byte_limit_before_consuming_the_slot() {
        let scratch = ScratchDirectory::new("oversized");
        let submitted = AtomicU8::new(SUBMISSION_IDLE);
        let capture_outcome = AtomicU8::new(CAPTURE_OUTCOME_NONE);
        let payload = format!(r#"{{"value":"{}"}}"#, "x".repeat(MAX_PAYLOAD_BYTES));

        assert_eq!(
            submit_once(
                &submitted,
                &capture_outcome,
                &config(scratch.output()),
                &payload,
                TOKEN,
            ),
            Err("Performance capture payload size was rejected.".to_owned())
        );
        assert_eq!(submitted.load(Ordering::Acquire), SUBMISSION_IDLE);
    }

    #[test]
    fn existing_result_is_never_overwritten_and_failure_is_one_shot() {
        let scratch = ScratchDirectory::new("existing");
        let output = scratch.output();
        fs::write(&output, "owned by driver").expect("seed output");
        let submitted = AtomicU8::new(SUBMISSION_IDLE);
        let capture_outcome = AtomicU8::new(CAPTURE_OUTCOME_NONE);
        let capture = config(output.clone());

        assert_eq!(
            submit_once(&submitted, &capture_outcome, &capture, "{}", TOKEN),
            Err("Performance capture output could not be published.".to_owned())
        );
        assert_eq!(
            capture_outcome.load(Ordering::Acquire),
            CAPTURE_OUTCOME_NONE
        );
        assert_eq!(
            fs::read_to_string(output).expect("read result"),
            "owned by driver"
        );
        assert_eq!(
            submit_once(&submitted, &capture_outcome, &capture, "{}", TOKEN),
            Err("Performance capture was already submitted.".to_owned())
        );
        assert_eq!(fs::read_dir(&scratch.0).expect("read scratch").count(), 1);
    }

    #[test]
    fn concurrent_submissions_publish_exactly_once() {
        let scratch = ScratchDirectory::new("concurrent");
        let output = scratch.output();
        let capture = Arc::new(config(output.clone()));
        let submitted = Arc::new(AtomicU8::new(SUBMISSION_IDLE));
        let capture_outcome = Arc::new(AtomicU8::new(CAPTURE_OUTCOME_NONE));
        let barrier = Arc::new(Barrier::new(8));
        let handles = (0..8)
            .map(|index| {
                let capture = Arc::clone(&capture);
                let submitted = Arc::clone(&submitted);
                let capture_outcome = Arc::clone(&capture_outcome);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    let payload = format!(r#"{{"winner":{index}}}"#);
                    barrier.wait();
                    submit_once(&submitted, &capture_outcome, &capture, &payload, TOKEN)
                })
            })
            .collect::<Vec<_>>();
        let outcomes = handles
            .into_iter()
            .map(|handle| handle.join().expect("join submission"))
            .collect::<Vec<_>>();

        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        let published: Value =
            serde_json::from_str(&fs::read_to_string(output).expect("read published result"))
                .expect("parse published result");
        assert!(published.get("winner").is_some());
    }

    #[test]
    fn result_path_must_be_absolute_and_normalized() {
        assert!(!valid_result_path(Path::new("relative/result.json")));
        assert!(!valid_result_path(Path::new("/tmp/../result.json")));
        assert!(valid_result_path(Path::new("/tmp/result.json")));
    }

    #[test]
    fn configured_token_is_bounded_and_printable() {
        assert!(!valid_config_token("short"));
        assert!(!valid_config_token(&"x".repeat(257)));
        assert!(!valid_config_token(&format!("{}\n", "x".repeat(32))));
        assert!(valid_config_token(TOKEN));
    }

    #[test]
    fn worker_join_failure_finalizes_the_one_shot_state() {
        let state = AtomicU8::new(SUBMISSION_PROCESSING);

        assert_eq!(
            finish_worker_outcome(&state, Err(())),
            Err("Performance capture worker failed.".to_owned())
        );
        assert_eq!(state.load(Ordering::Acquire), SUBMISSION_DONE);
        assert_eq!(
            claim_submission(&state),
            Err("Performance capture was already submitted.".to_owned())
        );
    }
}
