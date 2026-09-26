use super::*;
use crate::git::file_discard::{GitDiscardAction, GitDiscardPreparation};
use crate::git::head_amend::GitAmendFileAction;
use crate::git::GitChangeStatus;
use serde_json::Value;
use std::{path::Path, process::Command};

const CONTRACT: &str = include_str!("../../../contracts/git-working-tree-wire.json");
const UNTRUSTED: &str = "Git in the right panel requires a trusted repository.";

fn fixture(path: &[&str]) -> Value {
    let mut value = serde_json::from_str::<Value>(CONTRACT).expect("parse the contract");
    for key in path {
        value = value.get(key).cloned().unwrap_or(Value::Null);
    }
    value
}

fn encoded<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serialize the wire value")
}

fn git(root: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .expect("run git");
    assert!(output.status.success(), "git {arguments:?} failed");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn repository(label: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "git-working-tree-commands-{label}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("create repository");
    let root = root.canonicalize().expect("canonical repository");
    git(&root, &["init", "--initial-branch=main"]);
    std::fs::write(root.join("shared.txt"), "base\n").expect("write file");
    git(&root, &["add", "shared.txt"]);
    git(
        &root,
        &[
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@e.x",
            "commit",
            "-m",
            "base",
        ],
    );
    root
}

fn discard_file_json(status: &str) -> Value {
    serde_json::json!({
        "relativePath": "shared.txt",
        "oldRelativePath": null,
        "expectedStatus": status
    })
}

fn prepare_request(root: &Path, status: &str) -> GitPrepareDiscardRequest {
    serde_json::from_value(serde_json::json!({
        "repositoryRoot": root.to_string_lossy(),
        "worktreePath": null,
        "file": discard_file_json(status)
    }))
    .expect("prepare request")
}

fn discard_request(root: &Path, status: &str, fingerprint: &str) -> GitDiscardFileRequest {
    serde_json::from_value(serde_json::json!({
        "repositoryRoot": root.to_string_lossy(),
        "worktreePath": null,
        "file": discard_file_json(status),
        "fingerprint": fingerprint
    }))
    .expect("discard request")
}

#[test]
fn amend_candidates_and_receipts_serialize_to_the_shared_contract() {
    let head = "0123456789abcdef0123456789abcdef01234567".to_string();
    assert_eq!(
        encoded(&GitAmendCandidate::Ready {
            head_sha: head,
            message: "feat: first\n\nBody line.".to_string(),
        }),
        fixture(&["amendCandidates", "ready"])
    );
    assert_eq!(
        encoded(&GitAmendCandidate::NoCommit),
        fixture(&["amendCandidates", "noCommit"])
    );
    assert_eq!(
        encoded(&GitAmendCandidate::OperationInProgress),
        fixture(&["amendCandidates", "operationInProgress"])
    );
    assert_eq!(
        encoded(&GitDiscardPreparation {
            fingerprint: "cd".repeat(32),
        }),
        fixture(&["discardPreparation"])
    );
    assert_eq!(
        encoded(&GitAmendCandidate::Pushed {
            head_sha: "89abcdef0123456789abcdef0123456789abcdef".to_string(),
        }),
        fixture(&["amendCandidates", "pushed"])
    );
    assert_eq!(
        encoded(&GitAmendCandidate::MessageTooLarge {
            head_sha: "fedcba9876543210fedcba9876543210fedcba98".to_string(),
        }),
        fixture(&["amendCandidates", "messageTooLarge"])
    );
    assert_eq!(
        encoded(&GitAmendReceipt {
            head_sha: "1111111111111111111111111111111111111111".to_string(),
            index_synced: true,
        }),
        fixture(&["amendReceipt"])
    );
    assert_eq!(
        encoded(&GitDiscardReceipt {
            relative_path: "src/moved.ts".to_string(),
            action: GitDiscardAction::Restored,
        }),
        fixture(&["discardReceipts", "restored"])
    );
    assert_eq!(
        encoded(&GitDiscardReceipt {
            relative_path: "notes.txt".to_string(),
            action: GitDiscardAction::Deleted,
        }),
        fixture(&["discardReceipts", "deleted"])
    );
}

#[test]
fn requests_parse_from_the_shared_contract_and_reject_unknown_fields() {
    let amend =
        serde_json::from_value::<GitAmendHeadRequest>(fixture(&["amendRequest", "request"]))
            .expect("amend request");
    assert_eq!(amend.files.len(), 2);
    assert_eq!(amend.files[0].relative_path, "src/a.ts");
    assert_eq!(amend.files[1].action, GitAmendFileAction::StageDeletion);
    assert_eq!(amend.worktree_path.as_deref(), Some("/repo/.worktrees/t"));
    let discard =
        serde_json::from_value::<GitDiscardFileRequest>(fixture(&["discardRequest", "request"]))
            .expect("discard request");
    assert_eq!(discard.file.expected_status, GitChangeStatus::Renamed);
    assert_eq!(
        discard.file.old_relative_path.as_deref(),
        Some("src/old.ts")
    );
    assert_eq!(discard.fingerprint, "ab".repeat(32));
    let prepare = serde_json::from_value::<GitPrepareDiscardRequest>(fixture(&[
        "prepareDiscardRequest",
        "request",
    ]))
    .expect("prepare request");
    assert_eq!(prepare.file.relative_path, "notes.txt");

    let mut extended = fixture(&["amendRequest", "request"]);
    extended["argv"] = serde_json::json!(["--no-verify"]);
    assert!(serde_json::from_value::<GitAmendHeadRequest>(extended).is_err());
    let mut extended = fixture(&["discardRequest", "request"]);
    extended["file"]["force"] = serde_json::json!(true);
    assert!(serde_json::from_value::<GitDiscardFileRequest>(extended).is_err());
    let mut unknown_status = fixture(&["discardRequest", "request"]);
    unknown_status["file"]["expectedStatus"] = serde_json::json!("ignored");
    assert!(serde_json::from_value::<GitDiscardFileRequest>(unknown_status).is_err());
    assert!(
        serde_json::from_value::<GitAmendCandidateRequest>(serde_json::json!({
            "repositoryRoot": "/repo",
            "worktreePath": null,
            "shell": "rm -rf /"
        }))
        .is_err()
    );
}

#[test]
fn untrusted_repositories_are_refused_before_git_runs() {
    let root = repository("untrusted");
    std::fs::write(root.join("shared.txt"), "edited\n").expect("edit file");
    let candidate = tauri::async_runtime::block_on(get_git_amend_candidate(
        GitAmendCandidateRequest {
            repository_root: root.to_string_lossy().to_string(),
            worktree_path: None,
        },
        false,
    ));
    let prepared = tauri::async_runtime::block_on(prepare_git_discard(
        prepare_request(&root, "modified"),
        false,
    ));
    let discarded = tauri::async_runtime::block_on(discard_git_file(
        discard_request(&root, "modified", &"a".repeat(64)),
        false,
    ));
    let amended = tauri::async_runtime::block_on(amend_git_head(
        GitAmendHeadRequest {
            repository_root: root.to_string_lossy().to_string(),
            worktree_path: None,
            expected_head: git(&root, &["rev-parse", "HEAD"]),
            message: "rewrite".to_string(),
            files: Vec::new(),
        },
        false,
    ));
    let content = std::fs::read_to_string(root.join("shared.txt")).expect("read file");
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(candidate, Err(UNTRUSTED.to_string()));
    assert_eq!(prepared, Err(UNTRUSTED.to_string()));
    assert_eq!(discarded, Err(UNTRUSTED.to_string()));
    assert_eq!(amended, Err(UNTRUSTED.to_string()));
    assert_eq!(content, "edited\n");
}

#[test]
fn trusted_discard_touches_only_the_requested_repository() {
    let first = repository("first");
    let second = repository("second");
    std::fs::write(first.join("shared.txt"), "first edit\n").expect("edit first");
    std::fs::write(second.join("shared.txt"), "second edit\n").expect("edit second");

    let prepared = tauri::async_runtime::block_on(prepare_git_discard(
        prepare_request(&first, "modified"),
        true,
    ))
    .expect("prepare");
    let receipt = tauri::async_runtime::block_on(discard_git_file(
        discard_request(&first, "modified", &prepared.fingerprint),
        true,
    ));
    let first_content = std::fs::read_to_string(first.join("shared.txt")).expect("read first");
    let second_content = std::fs::read_to_string(second.join("shared.txt")).expect("read second");
    let _ = std::fs::remove_dir_all(&first);
    let _ = std::fs::remove_dir_all(&second);

    assert_eq!(
        receipt.map(|receipt| receipt.action),
        Ok(GitDiscardAction::Restored)
    );
    assert_eq!(first_content, "base\n");
    assert_eq!(second_content, "second edit\n");
}

#[test]
fn trusted_amend_rewrites_only_the_requested_repository_head() {
    let first = repository("amend-first");
    let second = repository("amend-second");
    let second_head = git(&second, &["rev-parse", "HEAD"]);
    let candidate = tauri::async_runtime::block_on(get_git_amend_candidate(
        GitAmendCandidateRequest {
            repository_root: first.to_string_lossy().to_string(),
            worktree_path: None,
        },
        true,
    ));
    let Ok(GitAmendCandidate::Ready { head_sha, message }) = candidate else {
        panic!("expected a ready candidate, got {candidate:?}");
    };
    assert_eq!(message, "base");

    let receipt = tauri::async_runtime::block_on(amend_git_head(
        GitAmendHeadRequest {
            repository_root: first.to_string_lossy().to_string(),
            worktree_path: None,
            expected_head: head_sha,
            message: "base, amended".to_string(),
            files: Vec::new(),
        },
        true,
    ));
    let first_message = git(&first, &["log", "-1", "--format=%B"]);
    let first_head = git(&first, &["rev-parse", "HEAD"]);
    let second_after = git(&second, &["rev-parse", "HEAD"]);
    let _ = std::fs::remove_dir_all(&first);
    let _ = std::fs::remove_dir_all(&second);

    assert_eq!(receipt.map(|receipt| receipt.head_sha), Ok(first_head));
    assert_eq!(first_message, "base, amended");
    assert_eq!(second_after, second_head);
}
