use serde_json::Value;

use super::super::git_branch_diff::{
    BranchChangedFile, BranchChanges, BranchFileSides, BranchSide,
};
use super::{GitSurfaceStatus, LineStat, SurfaceUpstream, UnpushedCommit};

const CONTRACT: &str = include_str!("../../contracts/git-surface-wire.json");

fn fixture(key: &str) -> Value {
    let contract = serde_json::from_str::<Value>(CONTRACT).expect("parse the git surface contract");
    contract.get(key).cloned().unwrap_or(Value::Null)
}

fn encoded<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serialize the wire value")
}

#[test]
fn surface_status_serializes_to_the_shared_contract() {
    let status = GitSurfaceStatus {
        branch: Some("feat/x".into()),
        default_base: Some("main".into()),
        has_remote: true,
        upstream: Some(SurfaceUpstream {
            name: "origin/feat/x".into(),
            ahead: 2,
            behind: 1,
        }),
        unpushed: vec![UnpushedCommit {
            sha: "0123456789abcdef0123456789abcdef01234567".into(),
            short_sha: "0123456".into(),
            subject: "fix: keep pre-1970 dates".into(),
            authored_at_epoch_seconds: -86_400,
        }],
        unpushed_truncated: false,
        line_stats: vec![
            LineStat {
                relative_path: "src/a.ts".into(),
                added: Some(3),
                deleted: Some(1),
            },
            LineStat {
                relative_path: "assets/logo.png".into(),
                added: None,
                deleted: None,
            },
        ],
        line_stats_truncated: true,
        local_branches: vec!["feat/x".into(), "main".into()],
        remote_branches: vec!["origin/main".into()],
        worktree_branches: vec!["fix/payments".into()],
        branches_truncated: false,
    };

    assert_eq!(encoded(&status), fixture("gitSurfaceStatus"));
}

#[test]
fn branch_changes_serialize_to_the_shared_contract() {
    let changes = BranchChanges {
        merge_base: "89abcdef0123456789abcdef0123456789abcdef".into(),
        head_commit: "fedcba9876543210fedcba9876543210fedcba98".into(),
        files: vec![
            BranchChangedFile {
                relative_path: "src/new.ts".into(),
                old_relative_path: Some("src/old.ts".into()),
                status: "renamed",
                added: Some(4),
                deleted: Some(2),
            },
            BranchChangedFile {
                relative_path: "src/added.ts".into(),
                old_relative_path: None,
                status: "added",
                added: None,
                deleted: None,
            },
        ],
        truncated: false,
        stats_truncated: true,
    };

    assert_eq!(encoded(&changes), fixture("branchChanges"));
}

#[test]
fn branch_file_sides_serialize_to_the_shared_contract() {
    let sides = BranchFileSides {
        original: BranchSide {
            text: "one\n".into(),
        },
        modified: BranchSide {
            text: "two\n".into(),
        },
        unavailable_reason: None,
    };
    let unavailable = BranchFileSides {
        original: BranchSide {
            text: String::new(),
        },
        modified: BranchSide {
            text: String::new(),
        },
        unavailable_reason: Some("large"),
    };

    assert_eq!(encoded(&sides), fixture("branchFileSides"));
    assert_eq!(encoded(&unavailable), fixture("branchFileSidesUnavailable"));
}

fn decodes<T: serde::de::DeserializeOwned>(request: &Value) -> bool {
    serde_json::from_value::<T>(request.clone()).is_ok()
}

fn decoder(name: &str) -> Option<fn(&Value) -> bool> {
    let decode: fn(&Value) -> bool = match name {
        "surfaceTarget" => decodes::<super::super::GitSurfaceTargetRequest>,
        "branchChanges" => decodes::<super::super::GitBranchChangesRequest>,
        "branchFileSides" => decodes::<super::super::GitBranchFileDiffRequest>,
        "addBranchWorktree" => {
            decodes::<super::super::super::git_worktree_commands::AddBranchWorktreeRequest>
        }
        "pullRequestContext" => {
            decodes::<super::super::super::pull_request_commands::PullRequestContextRequest>
        }
        "createPullRequest" => {
            decodes::<super::super::super::pull_request_commands::CreatePullRequestRequest>
        }
        _ => return None,
    };
    Some(decode)
}

#[test]
fn every_request_fixture_decodes_into_its_strict_request() {
    let requests = fixture("requests");
    let requests = requests.as_object().expect("requests fixture object");
    assert_eq!(requests.len(), 6);

    for (name, request) in requests {
        let decode = decoder(name).expect("every request fixture has a strict decoder");
        assert!(decode(request), "{name} fixture must decode");
        let mut extended = request.clone();
        extended
            .as_object_mut()
            .expect("request fixture object")
            .insert("unexpected".to_string(), Value::Bool(true));
        assert!(!decode(&extended), "{name} must reject unknown fields");
    }
}
