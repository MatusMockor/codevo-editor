use super::{
    execute_registered_workspace_teardown, teardown_exact_workspace,
    DisposeRegisteredWorkspaceRequest, ExactWorkspaceTeardownOutcome,
    RegisteredWorkspaceTeardownStep,
};
use crate::workspace_registry::WorkspaceRegistry;
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn exact_teardown_closes_only_the_requested_registered_workspace() {
    let registry = WorkspaceRegistry::new();
    let root_a = temporary_workspace("exact-a");
    let root_b = temporary_workspace("exact-b");
    let registration_a = registry.register_with_receipt(&root_a).expect("register A");
    let registration_b = registry.register_with_receipt(&root_b).expect("register B");
    let mut cleaned = Vec::new();

    let outcome = teardown_exact_workspace(
        &registry,
        &registration_a.receipt.workspace_id,
        registration_a.receipt.admission_token,
        &registration_a.descriptor.selected_root_path,
        &registration_a.descriptor.canonical_root_path,
        |descriptor| {
            cleaned.push(descriptor.workspace_id.clone());
            Vec::new()
        },
    )
    .expect("exact teardown");

    assert!(matches!(outcome, ExactWorkspaceTeardownOutcome::Closed));
    assert_eq!(cleaned, vec![registration_a.receipt.workspace_id.clone()]);
    assert!(registry
        .descriptor(&registration_a.receipt.workspace_id)
        .is_err());
    assert_eq!(
        registry
            .descriptor(&registration_b.receipt.workspace_id)
            .expect("B remains registered"),
        registration_b.descriptor
    );
    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

#[test]
fn stale_first_generation_teardown_cannot_touch_reopened_workspace() {
    let registry = WorkspaceRegistry::new();
    let root_a = temporary_workspace("exact-aba-a");
    let root_b = temporary_workspace("exact-aba-b");
    let first_a = registry
        .register_with_receipt(&root_a)
        .expect("register A1");
    let b = registry.register_with_receipt(&root_b).expect("register B");
    let first_outcome = teardown_exact_workspace(
        &registry,
        &first_a.receipt.workspace_id,
        first_a.receipt.admission_token,
        &first_a.descriptor.selected_root_path,
        &first_a.descriptor.canonical_root_path,
        |_| Vec::new(),
    )
    .expect("close A1");
    assert!(matches!(
        first_outcome,
        ExactWorkspaceTeardownOutcome::Closed
    ));
    let second_a = registry
        .register_with_receipt(&root_a)
        .expect("register A2");
    let cleanup_called = Arc::new(AtomicBool::new(false));
    let cleanup_called_for_request = Arc::clone(&cleanup_called);

    let stale = teardown_exact_workspace(
        &registry,
        &first_a.receipt.workspace_id,
        first_a.receipt.admission_token,
        &first_a.descriptor.selected_root_path,
        &first_a.descriptor.canonical_root_path,
        move |_| {
            cleanup_called_for_request.store(true, Ordering::SeqCst);
            Vec::new()
        },
    );

    assert!(stale.is_err());
    assert!(!cleanup_called.load(Ordering::SeqCst));
    assert_eq!(
        registry
            .descriptor(&second_a.receipt.workspace_id)
            .expect("A2 remains registered"),
        second_a.descriptor
    );
    assert_eq!(
        registry
            .descriptor(&b.receipt.workspace_id)
            .expect("B remains registered"),
        b.descriptor
    );
    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

#[test]
fn delayed_exact_teardown_fences_same_root_replacement_without_blocking_other_roots() {
    let registry = Arc::new(WorkspaceRegistry::new());
    let root_a = temporary_workspace("exact-delayed-a");
    let root_b = temporary_workspace("exact-delayed-b");
    let first_a = registry
        .register_with_receipt(&root_a)
        .expect("register A1");
    let first_b = registry
        .register_with_receipt(&root_b)
        .expect("register B1");
    let first_a_id = first_a.receipt.workspace_id.clone();
    let (started_tx, started_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let teardown_registry = Arc::clone(&registry);
    let teardown = thread::spawn(move || {
        teardown_exact_workspace(
            &teardown_registry,
            &first_a.receipt.workspace_id,
            first_a.receipt.admission_token,
            &first_a.descriptor.selected_root_path,
            &first_a.descriptor.canonical_root_path,
            |_| {
                started_tx.send(()).expect("publish cleanup start");
                release_rx.recv().expect("release cleanup");
                Vec::new()
            },
        )
    });

    started_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("cleanup starts");
    assert_eq!(
        registry
            .register_with_receipt(&root_a)
            .expect_err("A2 is fenced during A1 cleanup")
            .kind(),
        std::io::ErrorKind::WouldBlock
    );
    let second_b = registry
        .register_with_receipt(&root_b)
        .expect("B2 is not blocked by A1 cleanup");
    assert_eq!(first_b.receipt.workspace_id, second_b.receipt.workspace_id);
    release_tx.send(()).expect("release A1 cleanup");
    let outcome = teardown.join().expect("join teardown").expect("close A1");
    assert!(matches!(outcome, ExactWorkspaceTeardownOutcome::Closed));
    let second_a = registry
        .register_with_receipt(&root_a)
        .expect("register A2 after A1 finalization");
    assert_ne!(first_a_id, second_a.receipt.workspace_id);
    assert_eq!(
        registry
            .descriptor(&second_a.receipt.workspace_id)
            .expect("A2 remains registered"),
        second_a.descriptor
    );
    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

#[test]
fn replaced_admission_for_the_same_identity_rejects_the_predecessor() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-admission-replacement");
    let first = registry
        .register_with_receipt(&root)
        .expect("register first admission");
    let replacement = registry
        .register_with_receipt(&root)
        .expect("register replacement admission");
    assert_eq!(first.receipt.workspace_id, replacement.receipt.workspace_id);
    let cleanup_called = Arc::new(AtomicBool::new(false));
    let cleanup_called_for_request = Arc::clone(&cleanup_called);

    let stale = teardown_exact_workspace(
        &registry,
        &first.receipt.workspace_id,
        first.receipt.admission_token,
        &first.descriptor.selected_root_path,
        &first.descriptor.canonical_root_path,
        move |_| {
            cleanup_called_for_request.store(true, Ordering::SeqCst);
            Vec::new()
        },
    );

    assert!(stale.is_err());
    assert!(!cleanup_called.load(Ordering::SeqCst));
    assert_eq!(
        registry
            .descriptor(&replacement.receipt.workspace_id)
            .expect("replacement remains current"),
        replacement.descriptor
    );
    let closed = teardown_exact_workspace(
        &registry,
        &replacement.receipt.workspace_id,
        replacement.receipt.admission_token,
        &replacement.descriptor.selected_root_path,
        &replacement.descriptor.canonical_root_path,
        |_| Vec::new(),
    )
    .expect("close replacement");
    assert!(matches!(closed, ExactWorkspaceTeardownOutcome::Closed));
    fs::remove_dir_all(root).expect("cleanup root");
}

#[test]
fn exact_teardown_rejects_descriptor_path_mismatch_before_cleanup() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-descriptor-mismatch");
    let foreign_root = temporary_workspace("exact-descriptor-foreign");
    let registration = registry
        .register_with_receipt(&root)
        .expect("register workspace");
    let cleanup_called = Arc::new(AtomicBool::new(false));
    let cleanup_called_for_request = Arc::clone(&cleanup_called);

    let rejected = teardown_exact_workspace(
        &registry,
        &registration.receipt.workspace_id,
        registration.receipt.admission_token,
        &registration.descriptor.selected_root_path,
        &foreign_root,
        move |_| {
            cleanup_called_for_request.store(true, Ordering::SeqCst);
            Vec::new()
        },
    );

    let error = match rejected {
        Ok(_) => panic!("foreign canonical root must be stale"),
        Err(error) => error,
    };
    assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
    assert!(!cleanup_called.load(Ordering::SeqCst));
    assert_eq!(
        registry
            .descriptor(&registration.receipt.workspace_id)
            .expect("identity remains registered"),
        registration.descriptor
    );
    fs::remove_dir_all(root).expect("cleanup root");
    fs::remove_dir_all(foreign_root).expect("cleanup foreign root");
}

#[cfg(unix)]
#[test]
fn exact_teardown_accepts_the_registered_alias_and_canonical_descriptor_pair() {
    use std::os::unix::fs::symlink;

    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-alias-root");
    let alias = root.with_extension("alias");
    symlink(&root, &alias).expect("create alias");
    let registration = registry
        .register_with_receipt(&alias)
        .expect("register alias");

    let outcome = teardown_exact_workspace(
        &registry,
        &registration.receipt.workspace_id,
        registration.receipt.admission_token,
        &alias,
        &registration.descriptor.canonical_root_path,
        |_| Vec::new(),
    )
    .expect("close alias identity");

    assert!(matches!(outcome, ExactWorkspaceTeardownOutcome::Closed));
    assert!(registry
        .descriptor(&registration.receipt.workspace_id)
        .is_err());
    fs::remove_file(alias).expect("cleanup alias");
    fs::remove_dir_all(root).expect("cleanup root");
}

#[test]
fn incomplete_exact_teardown_preserves_identity_and_can_be_retried() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-incomplete");
    let registration = registry
        .register_with_receipt(&root)
        .expect("register workspace");

    let outcome = teardown_exact_workspace(
        &registry,
        &registration.receipt.workspace_id,
        registration.receipt.admission_token,
        &registration.descriptor.selected_root_path,
        &registration.descriptor.canonical_root_path,
        |_| vec!["terminal cleanup incomplete".to_string()],
    )
    .expect("incomplete outcome");

    match outcome {
        ExactWorkspaceTeardownOutcome::Incomplete(errors) => {
            assert_eq!(errors, vec!["terminal cleanup incomplete"]);
        }
        ExactWorkspaceTeardownOutcome::Closed => panic!("cleanup must remain incomplete"),
    }
    assert_eq!(
        registry
            .descriptor(&registration.receipt.workspace_id)
            .expect("identity remains registered"),
        registration.descriptor
    );

    let retry = teardown_exact_workspace(
        &registry,
        &registration.receipt.workspace_id,
        registration.receipt.admission_token,
        &registration.descriptor.selected_root_path,
        &registration.descriptor.canonical_root_path,
        |_| Vec::new(),
    )
    .expect("retry teardown");
    assert!(matches!(retry, ExactWorkspaceTeardownOutcome::Closed));
    assert!(registry
        .descriptor(&registration.receipt.workspace_id)
        .is_err());
    fs::remove_dir_all(root).expect("cleanup root");
}

#[test]
fn panicking_exact_cleanup_finalizes_the_reserved_identity() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-panic");
    let registration = registry
        .register_with_receipt(&root)
        .expect("register workspace");

    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = teardown_exact_workspace(
            &registry,
            &registration.receipt.workspace_id,
            registration.receipt.admission_token,
            &registration.descriptor.selected_root_path,
            &registration.descriptor.canonical_root_path,
            |_| panic!("destructive cleanup panic"),
        );
    }));

    assert!(panic.is_err());
    assert!(registry
        .descriptor(&registration.receipt.workspace_id)
        .is_err());
    fs::remove_dir_all(root).expect("cleanup root");
}

#[test]
fn registered_workspace_teardown_executes_each_collaborator_once_in_owned_order() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-order");
    let registration = registry
        .register_with_receipt(&root)
        .expect("register workspace");
    let mut steps = Vec::new();

    let outcome = teardown_exact_workspace(
        &registry,
        &registration.receipt.workspace_id,
        registration.receipt.admission_token,
        &registration.descriptor.selected_root_path,
        &registration.descriptor.canonical_root_path,
        |_| {
            execute_registered_workspace_teardown(|step| {
                steps.push(step);
                None
            })
        },
    )
    .expect("ordered teardown");

    assert!(matches!(outcome, ExactWorkspaceTeardownOutcome::Closed));
    assert_eq!(steps, complete_teardown_order());
    assert!(registry
        .descriptor(&registration.receipt.workspace_id)
        .is_err());
    fs::remove_dir_all(root).expect("cleanup root");
}

#[test]
fn mixed_teardown_errors_run_best_effort_order_and_restore_identity_without_history_cleanup() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("exact-mixed-errors");
    let registration = registry
        .register_with_receipt(&root)
        .expect("register workspace");
    let mut steps = Vec::new();

    let outcome = teardown_exact_workspace(
        &registry,
        &registration.receipt.workspace_id,
        registration.receipt.admission_token,
        &registration.descriptor.selected_root_path,
        &registration.descriptor.canonical_root_path,
        |_| {
            execute_registered_workspace_teardown(|step| {
                steps.push(step);
                match step {
                    RegisteredWorkspaceTeardownStep::DocumentAdmission => {
                        Some("document cleanup failed".to_string())
                    }
                    RegisteredWorkspaceTeardownStep::Runtime => {
                        Some("terminal cleanup failed".to_string())
                    }
                    RegisteredWorkspaceTeardownStep::NodeAttachCandidates
                    | RegisteredWorkspaceTeardownStep::AgentTasks
                    | RegisteredWorkspaceTeardownStep::FileSearch
                    | RegisteredWorkspaceTeardownStep::JavascriptTasks
                    | RegisteredWorkspaceTeardownStep::SmartMode
                    | RegisteredWorkspaceTeardownStep::LocalHistory => None,
                }
            })
        },
    )
    .expect("incomplete teardown");

    match outcome {
        ExactWorkspaceTeardownOutcome::Incomplete(errors) => {
            assert_eq!(
                errors,
                vec!["document cleanup failed", "terminal cleanup failed"]
            );
        }
        ExactWorkspaceTeardownOutcome::Closed => panic!("mixed errors must remain incomplete"),
    }
    assert_eq!(
        steps,
        complete_teardown_order()[..complete_teardown_order().len() - 1]
    );
    assert_eq!(
        registry
            .descriptor(&registration.receipt.workspace_id)
            .expect("identity remains registered"),
        registration.descriptor
    );
    fs::remove_dir_all(root).expect("cleanup root");
}

#[test]
fn exact_teardown_request_rejects_unknown_fields() {
    let request = serde_json::json!({
        "workspaceId": "ws-test",
        "admissionToken": 1,
        "selectedRootPath": "/workspace",
        "canonicalRootPath": "/workspace",
        "extra": true
    });

    assert!(serde_json::from_value::<DisposeRegisteredWorkspaceRequest>(request).is_err());
}

fn complete_teardown_order() -> Vec<RegisteredWorkspaceTeardownStep> {
    vec![
        RegisteredWorkspaceTeardownStep::NodeAttachCandidates,
        RegisteredWorkspaceTeardownStep::AgentTasks,
        RegisteredWorkspaceTeardownStep::FileSearch,
        RegisteredWorkspaceTeardownStep::JavascriptTasks,
        RegisteredWorkspaceTeardownStep::DocumentAdmission,
        RegisteredWorkspaceTeardownStep::Runtime,
        RegisteredWorkspaceTeardownStep::SmartMode,
        RegisteredWorkspaceTeardownStep::LocalHistory,
    ]
}

fn temporary_workspace(label: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codevo-{label}-{nonce}"));
    fs::create_dir_all(&root).expect("create workspace");
    root
}
