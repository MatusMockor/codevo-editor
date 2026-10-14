use super::super::interactions_fake::{
    live, observed, retasked, sequenced, snapshot, task, APPROVAL, QUESTION,
};
use super::*;
use serde_json::json;

fn read(index: usize, name: &str, sequence: u64) -> RemoteInteractions {
    observed(
        sequenced(retasked(snapshot(name), &task(index)), sequence),
        InteractionSource::Snapshot,
    )
}

fn without_question(index: usize, sequence: u64) -> RemoteInteractions {
    let mut value = sequenced(retasked(live(), &task(index)), sequence);
    value["questions"] = json!([]);
    observed(value, InteractionSource::Snapshot)
}

#[test]
fn current_read_tracks_open_requests_by_kind_and_id() {
    let evidence = TaskEvidence::default();
    assert_eq!(
        evidence.observe(&read(1, "livePendingQuestionAndApproval", 3)),
        Verdict::Current
    );
    assert!(evidence.has_open_requests(&task(1)));
    assert_eq!(
        evidence.observe(&read(1, "answeredAndDecided", 6)),
        Verdict::Current
    );
    assert!(!evidence.has_open_requests(&task(1)));
    assert!(!evidence.is_incomplete(&task(1)));
}

#[test]
fn older_observation_is_stale_and_changes_nothing() {
    let evidence = TaskEvidence::default();
    evidence.observe(&read(1, "livePendingQuestionAndApproval", 4));
    let older = read(1, "empty", 3);
    assert!(evidence.is_stale(&older));
    assert_eq!(evidence.observe(&older), Verdict::Stale);
    assert!(evidence.has_open_requests(&task(1)));
    assert!(!evidence.is_incomplete(&task(1)));
    assert!(!evidence.is_stale(&read(1, "empty", 4)));
    let legacy = observed(
        sequenced(retasked(snapshot("empty"), &task(1)), 1),
        InteractionSource::Legacy,
    );
    assert!(!evidence.is_stale(&legacy));
}

#[test]
fn open_request_missing_from_a_complete_current_read_is_evidence() {
    let evidence = TaskEvidence::default();
    evidence.observe(&read(1, "livePendingQuestionAndApproval", 3));
    assert_eq!(evidence.observe(&without_question(1, 9)), Verdict::Vanished);
    assert!(evidence.is_incomplete(&task(1)));
    assert!(evidence.has_open_requests(&task(1)));
    assert_eq!(evidence.observe(&without_question(1, 9)), Verdict::Current);
}

#[test]
fn unavailable_approvals_section_is_never_evidence() {
    let evidence = TaskEvidence::default();
    evidence.observe(&read(1, "livePendingQuestionAndApproval", 100));
    let mut legacy = observed(
        sequenced(retasked(live(), &task(1)), 2),
        InteractionSource::Legacy,
    );
    legacy.approvals.clear();
    legacy.approvals_complete = false;
    assert_eq!(evidence.observe(&legacy), Verdict::Current);
    assert!(evidence.has_open_requests(&task(1)));
    legacy.questions.clear();
    assert_eq!(evidence.observe(&legacy), Verdict::Vanished);
    let mut complete = legacy.clone();
    complete.approvals_complete = true;
    assert_eq!(evidence.observe(&complete), Verdict::Vanished);
    assert!(!evidence.has_open_requests(&task(1)));
}

#[test]
fn published_answer_fences_its_request_against_delayed_pending_reads() {
    let evidence = TaskEvidence::default();
    evidence.observe(&read(1, "livePendingQuestionAndApproval", 3));
    evidence.published(&task(1), (RequestKind::Question, QUESTION.into()), false);
    evidence.published(&task(1), (RequestKind::Approval, APPROVAL.into()), false);
    assert!(!evidence.has_open_requests(&task(1)));
    assert_eq!(
        evidence.observe(&read(1, "livePendingQuestionAndApproval", 3)),
        Verdict::Current
    );
    assert!(!evidence.has_open_requests(&task(1)));
    assert_eq!(evidence.observe(&read(1, "empty", 90)), Verdict::Current);
    assert!(!evidence.is_incomplete(&task(1)));
    evidence.published(&task(2), (RequestKind::Approval, APPROVAL.into()), true);
    assert!(evidence.has_open_requests(&task(2)));
    for number in 0..(MAX_FENCED_PER_TASK + 10) {
        evidence.published(
            &task(3),
            (RequestKind::Question, format!("q{number}")),
            false,
        );
    }
    let tasks = evidence.locked();
    assert_eq!(tasks.tasks[&task(3)].settled.len(), MAX_FENCED_PER_TASK);
}

#[test]
fn confirmed_task_disappearance_is_evidence_only_when_something_was_open() {
    let evidence = TaskEvidence::default();
    assert_eq!(evidence.vanish(&task(1)), Verdict::Current);
    assert!(!evidence.is_incomplete(&task(1)));
    evidence.observe(&read(2, "livePendingQuestionAndApproval", 3));
    assert_eq!(evidence.vanish(&task(2)), Verdict::Vanished);
    assert!(evidence.is_incomplete(&task(2)));
    assert!(!evidence.has_open_requests(&task(2)));
    assert_eq!(evidence.vanish(&task(2)), Verdict::Current);
}

#[test]
fn forgotten_invalidation_keeps_every_message_incomplete_and_the_store_bounded() {
    let evidence = TaskEvidence::with_limit(2);
    evidence.observe(&read(1, "livePendingQuestionAndApproval", 3));
    evidence.vanish(&task(1));
    evidence.observe(&read(2, "answeredAndDecided", 6));
    assert!(!evidence.is_incomplete(&task(2)));
    evidence.observe(&read(3, "answeredAndDecided", 6));
    assert_eq!(evidence.tracked(), 2);
    assert!(evidence.is_incomplete(&task(1)));
    assert!(evidence.is_incomplete(&task(2)));
    assert!(!evidence.has_lost_open_evidence());
    evidence.observe(&read(4, "livePendingQuestionAndApproval", 3));
    evidence.observe(&read(5, "answeredAndDecided", 6));
    evidence.observe(&read(6, "answeredAndDecided", 6));
    assert!(evidence.has_lost_open_evidence());
    assert_eq!(evidence.tracked(), 2);
    assert_eq!(MAX_TRACKED_TASKS, 256);
}
