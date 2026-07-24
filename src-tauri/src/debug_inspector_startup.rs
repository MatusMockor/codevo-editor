use crate::debug_support::{file_url_from_path, path_from_file_url};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

pub(crate) struct StartupEntryProbe {
    breakpoint_id: String,
    result: Receiver<StartupEntryOutcome>,
}

pub(crate) struct StartupEntryValidation {
    breakpoint_id: String,
    expected_entry: PathBuf,
    result: Sender<StartupEntryOutcome>,
}

enum StartupEntryOutcome {
    ExpectedEntry,
    EarlyException,
    Rejected,
}

pub(crate) fn arm_startup_entry_probe(
    entry: &Path,
    mut request: impl FnMut(&str, Value) -> Result<Value, String>,
) -> Result<(StartupEntryProbe, StartupEntryValidation), String> {
    let expected_entry = entry
        .canonicalize()
        .map_err(|error| format!("Unable to resolve wrapper debug entry: {error}"))?;
    let response = request(
        "Debugger.setBreakpointByUrl",
        json!({
            "columnNumber": 0,
            "lineNumber": 0,
            "url": file_url_from_path(&expected_entry.to_string_lossy()),
        }),
    )?;
    let breakpoint_id = response
        .get("breakpointId")
        .and_then(Value::as_str)
        .ok_or_else(|| "The Node inspector did not accept the wrapper entry probe.".to_string())?
        .to_string();
    let (result_tx, result_rx) = mpsc::channel();
    Ok((
        StartupEntryProbe {
            breakpoint_id: breakpoint_id.clone(),
            result: result_rx,
        },
        StartupEntryValidation {
            breakpoint_id,
            expected_entry,
            result: result_tx,
        },
    ))
}

impl StartupEntryProbe {
    pub(crate) fn finish(
        self,
        timeout: Duration,
        mut request: impl FnMut(&str, Value) -> Result<Value, String>,
    ) -> Result<Option<String>, String> {
        let outcome = self.result.recv_timeout(timeout).map_err(|_| {
            "The allowlisted Node wrapper did not reach its validated workspace entry.".to_string()
        })?;
        if matches!(outcome, StartupEntryOutcome::EarlyException) {
            return Ok(Some(self.breakpoint_id));
        }
        let _ = request(
            "Debugger.removeBreakpoint",
            json!({"breakpointId": self.breakpoint_id}),
        );
        if matches!(outcome, StartupEntryOutcome::Rejected) {
            return Err(
                "The Node inspector paused outside the validated wrapper workspace entry."
                    .to_string(),
            );
        }
        Ok(None)
    }
}

impl StartupEntryValidation {
    pub(crate) fn breakpoint_id(&self) -> &str {
        &self.breakpoint_id
    }

    pub(crate) fn matches_pause(&self, params: &Value) -> bool {
        params
            .get("callFrames")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|frame| frame.get("url").and_then(Value::as_str))
            .filter_map(path_from_file_url)
            .filter_map(|path| PathBuf::from(path).canonicalize().ok())
            .any(|path| path == self.expected_entry)
    }

    pub(crate) fn complete(self, accepted: bool) {
        let outcome = if accepted {
            StartupEntryOutcome::ExpectedEntry
        } else {
            StartupEntryOutcome::Rejected
        };
        let _ = self.result.send(outcome);
    }

    pub(crate) fn complete_early_exception(self) {
        let _ = self.result.send(StartupEntryOutcome::EarlyException);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn fixture(name: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "debug-inspector-startup-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("src")).expect("fixture");
        let entry = root.join("src/app.ts");
        fs::write(&entry, "console.log('entry');").expect("entry");
        entry
    }

    #[test]
    fn probe_accepts_only_a_canonical_pause_in_the_validated_entry() {
        let entry = fixture("accept");
        let entry_url = file_url_from_path(
            &entry
                .canonicalize()
                .expect("canonical entry")
                .to_string_lossy(),
        );
        let (probe, validation) = arm_startup_entry_probe(&entry, |method, params| {
            assert_eq!(method, "Debugger.setBreakpointByUrl");
            assert_eq!(params["url"], entry_url);
            Ok(json!({"breakpointId": "startup-probe"}))
        })
        .expect("probe");
        assert!(validation.matches_pause(&json!({
            "callFrames": [{"url": entry_url}]
        })));
        validation.complete(true);
        assert!(probe
            .finish(Duration::from_secs(1), |method, params| {
                assert_eq!(method, "Debugger.removeBreakpoint");
                assert_eq!(params["breakpointId"], "startup-probe");
                Ok(json!({}))
            })
            .expect("accepted probe")
            .is_none());
        fs::remove_dir_all(entry.parent().and_then(Path::parent).unwrap()).expect("cleanup");
    }

    #[test]
    fn wrong_target_fails_closed() {
        let entry = fixture("reject");
        let (probe, validation) = arm_startup_entry_probe(&entry, |_method, _params| {
            Ok(json!({"breakpointId": "startup-probe"}))
        })
        .expect("probe");
        assert!(!validation.matches_pause(&json!({
            "callFrames": [{"url": "file:///workspace/node_modules/wrapper/cli.js"}]
        })));
        validation.complete(false);
        assert!(probe
            .finish(Duration::from_secs(1), |_method, _params| Ok(json!({})))
            .expect_err("wrong target")
            .contains("outside"));
        fs::remove_dir_all(entry.parent().and_then(Path::parent).unwrap()).expect("cleanup");
    }

    #[test]
    fn startup_probe_timeout_fails_closed() {
        let entry = fixture("timeout");
        let (probe, _validation) = arm_startup_entry_probe(&entry, |_method, _params| {
            Ok(json!({"breakpointId": "startup-probe"}))
        })
        .expect("probe");
        assert!(probe
            .finish(Duration::from_millis(10), |_method, _params| Ok(json!({})))
            .expect_err("timeout")
            .contains("did not reach"));
        fs::remove_dir_all(entry.parent().and_then(Path::parent).unwrap()).expect("cleanup");
    }

    #[test]
    fn early_exception_releases_registration_and_removes_the_probe() {
        let entry = fixture("early-exception");
        let (probe, validation) = arm_startup_entry_probe(&entry, |_method, _params| {
            Ok(json!({"breakpointId": "startup-probe"}))
        })
        .expect("probe");
        validation.complete_early_exception();
        let breakpoint_id = probe
            .finish(Duration::from_secs(1), |_method, _params| {
                panic!("early exception cleanup must not wait for a response")
            })
            .expect("early exception");
        assert_eq!(breakpoint_id.as_deref(), Some("startup-probe"));
        fs::remove_dir_all(entry.parent().and_then(Path::parent).unwrap()).expect("cleanup");
    }
}
