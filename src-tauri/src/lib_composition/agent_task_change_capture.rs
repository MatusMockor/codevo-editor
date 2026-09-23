use super::{agent_task_start_authority::retained_root_matches_path, AgentTaskMetadata};
use crate::agent_turn_changes::{
    AgentTurnChangesStore, CapturePhase, ChangesState, TurnChangesSummary,
};
use std::{
    fs::File,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};
use tauri::{AppHandle, Manager};

pub(super) fn capture(
    app: &AppHandle,
    task: &AgentTaskMetadata,
    authority: Option<&File>,
    phase: CapturePhase,
) {
    let result = catch_unwind(AssertUnwindSafe(|| {
        // An unavailable checkpoint is preferable to reading a replacement workspace.
        let authority = authority.ok_or("The original workspace is unavailable.".to_owned())?;
        if !retained_root_matches_path(authority, &task.cwd) {
            return Err("The workspace changed before recording turn changes.".to_owned());
        }
        let store = app
            .try_state::<Arc<AgentTurnChangesStore>>()
            .ok_or("The turn checkpoint store is unavailable.".to_owned())?;
        store.capture_with_authority(&task.cwd, &task.task_id, phase, authority)
    }))
    .unwrap_or_else(|_| Err("The turn checkpoint capture stopped unexpectedly.".to_owned()));
    if let Some(reason) = failure_reason(phase, &result) {
        // Storage persists safe capture failures in the summary shown by the UI. Keep
        // infrastructure failures observable as well without changing the agent result
        // or injecting unordered diagnostic messages into the provider output stream.
        eprintln!("{}", failure_message(&task.task_id, phase, reason));
    }
}

fn failure_reason(
    phase: CapturePhase,
    result: &Result<TurnChangesSummary, String>,
) -> Option<&str> {
    match result {
        Err(reason) => Some(reason),
        // The baseline intentionally returns an unavailable, unfinished summary.
        Ok(summary)
            if matches!(phase, CapturePhase::After)
                && summary.state == ChangesState::Unavailable =>
        {
            summary.reason.as_deref()
        }
        Ok(_) => None,
    }
}

fn failure_message(task_id: &str, phase: CapturePhase, reason: &str) -> String {
    let phase = match phase {
        CapturePhase::Before => "before",
        CapturePhase::After => "after",
    };
    format!(
        "Checkpoint capture failed ({phase}, task {}): {}",
        diagnostic_text(task_id, 256),
        diagnostic_text(reason, 512),
    )
}

fn diagnostic_text(value: &str, max_bytes: usize) -> String {
    let mut text = String::new();
    for character in value.chars() {
        let character = if character.is_control() {
            ' '
        } else {
            character
        };
        if text.len() + character.len_utf8() > max_bytes {
            break;
        }
        text.push(character);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unavailable(reason: &str) -> TurnChangesSummary {
        serde_json::from_value(serde_json::json!({
            "turnId": "turn-1",
            "state": "unavailable",
            "files": [],
            "truncated": false,
            "reason": reason,
        }))
        .unwrap()
    }

    #[test]
    fn pending_baseline_is_not_reported_as_a_capture_failure() {
        let result = Ok(unavailable(
            "No completed snapshot is available for this turn.",
        ));
        assert_eq!(failure_reason(CapturePhase::Before, &result), None);
        assert_eq!(
            failure_reason(CapturePhase::After, &result),
            Some("No completed snapshot is available for this turn.")
        );
    }

    #[test]
    fn ready_summary_with_display_limit_reason_is_not_a_capture_failure() {
        let mut summary = unavailable("Some changed files exceed the display limit.");
        summary.state = ChangesState::Ready;
        summary.truncated = true;
        assert_eq!(failure_reason(CapturePhase::After, &Ok(summary)), None);
    }

    #[test]
    fn unsupported_workspace_is_not_reported_as_a_capture_failure() {
        let summary: TurnChangesSummary = serde_json::from_value(serde_json::json!({
            "turnId": "turn-1",
            "state": "unsupported",
            "files": [],
            "truncated": false,
            "reason": "notGitRepository",
        }))
        .unwrap();
        assert_eq!(summary.state, ChangesState::Unsupported);
        for phase in [CapturePhase::Before, CapturePhase::After] {
            assert_eq!(failure_reason(phase, &Ok(summary.clone())), None);
        }
        assert_eq!(
            serde_json::to_value(&summary).unwrap()["state"],
            serde_json::json!("unsupported")
        );
        assert!(
            serde_json::from_value::<TurnChangesSummary>(serde_json::json!({
                "turnId": "turn-1",
                "state": "notGit",
                "files": [],
                "truncated": false,
                "reason": null,
            }))
            .is_err()
        );
    }

    #[test]
    fn capture_errors_keep_their_reason_in_both_phases() {
        let result = Err("Checkpoint storage is unavailable.".to_owned());
        for phase in [CapturePhase::Before, CapturePhase::After] {
            assert_eq!(
                failure_reason(phase, &result),
                Some("Checkpoint storage is unavailable.")
            );
        }
    }

    #[test]
    fn diagnostic_fields_are_single_line_utf8_and_bounded() {
        let task_id = "x\n\r\t\u{1b}injected";
        let message = failure_message(task_id, CapturePhase::After, &"ž".repeat(1_000));
        assert!(message.starts_with("Checkpoint capture failed (after, task x    injected): "));
        assert!(!message.chars().any(char::is_control));
        assert!(message.len() < 850);
        assert_eq!(diagnostic_text("žž", 3), "ž");
    }
}
