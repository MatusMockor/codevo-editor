#[test]
fn history_graph_all_branches_preserves_divergence_merge_and_detached_head() {
    let repo = branch_repo();
    repo.run(["commit", "--allow-empty", "-m", "root"]);
    repo.run(["checkout", "-b", "topic"]);
    repo.run(["commit", "--allow-empty", "-m", "topic"]);
    repo.run(["checkout", "main"]);
    repo.run(["commit", "--allow-empty", "-m", "main"]);
    let all = GitCommitFilters {
        all_branches: Some(true),
        ..empty_commit_filters()
    };
    let commits = load_commit_log(repo.path(), all.clone(), true).unwrap();
    assert_eq!(commits.len(), 3);
    assert_eq!(commits.last().unwrap().subject, "root");
    assert_eq!(
        load_commit_log(repo.path(), empty_commit_filters(), true)
            .unwrap()
            .len(),
        2
    );
    let topic = GitCommitFilters {
        branch: Some("refs/heads/topic".into()),
        ..empty_commit_filters()
    };
    assert_eq!(
        load_commit_log(repo.path(), topic, true).unwrap()[0].subject,
        "topic"
    );
    repo.run(["merge", "--no-ff", "topic", "-m", "merge"]);
    let commits = load_commit_log(repo.path(), all.clone(), true).unwrap();
    assert_eq!(commits[0].parents.len(), 2);
    for (index, commit) in commits.iter().enumerate() {
        for parent in &commit.parents {
            assert!(
                commits
                    .iter()
                    .position(|value| &value.hash == parent)
                    .unwrap()
                    > index
            );
        }
    }
    repo.run(["checkout", "--detach"]);
    repo.run(["commit", "--allow-empty", "-m", "detached"]);
    assert_eq!(
        load_commit_log(repo.path(), all, true).unwrap()[0].subject,
        "detached"
    );
    assert_eq!(
        super::load_git_branches(repo.path(), true).unwrap().current,
        None
    );
}

#[test]
fn history_graph_handles_unborn_heads_remote_refs_and_rejects_invalid_filters() {
    let repo = branch_repo();
    let all = GitCommitFilters {
        all_branches: Some(true),
        ..empty_commit_filters()
    };
    assert!(load_commit_log(repo.path(), all.clone(), true)
        .unwrap()
        .is_empty());
    repo.run(["commit", "--allow-empty", "-m", "root"]);
    repo.run(["update-ref", "refs/remotes/upstream/main", "HEAD"]);
    repo.run([
        "symbolic-ref",
        "refs/remotes/upstream/HEAD",
        "refs/remotes/upstream/main",
    ]);
    let branches = super::load_git_branches(repo.path(), true).unwrap();
    assert_eq!(branches.local, vec!["main"]);
    assert_eq!(branches.remotes["upstream"], vec!["main"]);
    let remote = GitCommitFilters {
        branch: Some("refs/remotes/upstream/main".into()),
        ..empty_commit_filters()
    };
    assert_eq!(load_commit_log(repo.path(), remote, true).unwrap().len(), 1);
    for reference in [
        "--all",
        "HEAD~1",
        "main..topic",
        "HEAD:path",
        "missing",
        "main\n",
    ] {
        let filters = GitCommitFilters {
            branch: Some(reference.into()),
            ..empty_commit_filters()
        };
        assert!(
            load_commit_log(repo.path(), filters, true).is_err(),
            "{reference}"
        );
    }
    let ambiguous = GitCommitFilters {
        branch: Some("main".into()),
        ..all.clone()
    };
    assert!(load_commit_log(repo.path(), ambiguous, true).is_err());
    repo.run(["checkout", "--orphan", "empty"]);
    assert!(load_commit_log(repo.path(), empty_commit_filters(), true)
        .unwrap()
        .is_empty());
    assert_eq!(load_commit_log(repo.path(), all, true).unwrap().len(), 1);
}

#[test]
fn history_filter_wire_defaults_and_unknown_fields_are_closed() {
    let filters: GitCommitFilters = serde_json::from_str("{}").unwrap();
    assert_eq!(filters.all_branches, None);
    let filters: GitCommitFilters = serde_json::from_str(r#"{"allBranches":true}"#).unwrap();
    assert_eq!(filters.all_branches, Some(true));
    assert_eq!(serde_json::to_value(filters).unwrap()["allBranches"], true);
    assert!(serde_json::from_str::<GitCommitFilters>(r#"{"allBranches":"yes"}"#).is_err());
    assert!(serde_json::from_str::<GitCommitFilters>(r#"{"unknown":true}"#).is_err());
}

#[test]
fn history_graph_preserves_control_message_and_comma_branch_labels() {
    let repo = branch_repo();
    repo.run([
        "commit",
        "--allow-empty",
        "-m",
        "subject\x1ftext\n\nbody\x1ftext",
    ]);
    repo.run(["branch", "feature/a,b"]);
    repo.run(["tag", "release,a"]);
    let commits = load_commit_log(repo.path(), empty_commit_filters(), true).unwrap();
    assert_eq!(commits[0].subject, "subject\x1ftext");
    assert!(commits[0].parents.is_empty());
    assert!(commits[0].labels.contains(&"feature/a,b".to_string()));
    assert!(commits[0].labels.contains(&"tag: release,a".to_string()));
    let details = load_commit_details(repo.path(), &commits[0].hash, true).unwrap();
    assert!(details.body.contains("body\x1ftext"));
    assert_eq!(details.commit.labels, commits[0].labels);
    for cursor in ["-1", "invalid", "500001", "999999999999999999999"] {
        let filters = GitCommitFilters {
            cursor: Some(cursor.into()),
            ..empty_commit_filters()
        };
        assert!(load_commit_log(repo.path(), filters, true).is_err());
    }
}
