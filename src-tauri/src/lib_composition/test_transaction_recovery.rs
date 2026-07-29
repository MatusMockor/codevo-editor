#[test]
fn transactional_workspace_edit_preserves_external_recreation_after_delete() {
    let root = temp_workspace("transactional-workspace-edit-delete-race");
    fs::write(root.join("a-delete.ts"), "original-a").unwrap();
    fs::write(root.join("b.ts"), "b").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("b.ts", "B", vec![]);
    edit.file_operations
        .push(LanguageServerWorkspaceFileOperation::Delete {
            uri: "a-delete.ts".into(),
            options: None,
        });

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, committed| {
            if committed != 1 || path != Path::new("b.ts") {
                return;
            }
            fs::write(root.join("a-delete.ts"), "external-a").unwrap();
            fs::write(root.join("b.ts"), "external-b").unwrap();
        },
    );

    let error = result.expect_err("the second-file conflict must reject the transaction");
    assert!(error.contains("preserved newer data"));
    assert_eq!(
        fs::read_to_string(root.join("a-delete.ts")).unwrap(),
        "external-a"
    );
    assert!(fs::read_dir(&root).unwrap().any(|entry| {
        let entry = entry.unwrap();
        entry
            .file_name()
            .to_string_lossy()
            .contains("codevo-backup")
            && fs::read_to_string(entry.path()).unwrap() == "original-a"
    }));
}

#[test]
fn transactional_workspace_edit_preserves_external_rename_target_during_rollback() {
    let root = temp_workspace("transactional-workspace-edit-rename-race");
    fs::write(root.join("a-source.ts"), "source").unwrap();
    fs::write(root.join("z-conflict.ts"), "z").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("z-conflict.ts", "Z", vec![]);
    edit.file_operations
        .push(LanguageServerWorkspaceFileOperation::Rename {
            old_uri: "a-source.ts".into(),
            new_uri: "b-moved.ts".into(),
            options: None,
        });

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, committed| {
            if committed != 2 || path != Path::new("z-conflict.ts") {
                return;
            }
            fs::write(root.join("b-moved.ts"), "external-target").unwrap();
            fs::write(root.join("z-conflict.ts"), "external-z").unwrap();
        },
    );

    let error = result.expect_err("the final-file conflict must reject the transaction");
    assert!(error.contains("preserved newer data"));
    assert_eq!(
        fs::read_to_string(root.join("a-source.ts")).unwrap(),
        "source"
    );
    assert_eq!(
        fs::read_to_string(root.join("b-moved.ts")).unwrap(),
        "external-target"
    );
    assert_eq!(
        fs::read_to_string(root.join("z-conflict.ts")).unwrap(),
        "external-z"
    );
}

#[test]
fn transactional_workspace_edit_rejects_a_stale_closed_file_hash_before_mutation() {
    let root = temp_workspace("transactional-workspace-edit-stale-hash");
    fs::write(root.join("a.php"), "before").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let edit = relative_workspace_edit("a.php", "changed-", vec![]);
    let expected = BTreeMap::from([("a.php".into(), Some("0".into()))]);

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &expected,
        &BTreeMap::new(),
        |_, _| {},
    );

    assert!(result
        .expect_err("a stale hash must reject before staging")
        .contains("file changed after workspace edit commit"));
    assert_eq!(fs::read_to_string(root.join("a.php")).unwrap(), "before");
}

#[test]
fn transactional_workspace_edit_returns_a_reversible_closed_file_edit() {
    use std::os::unix::fs::PermissionsExt;

    let root = temp_workspace("transactional-workspace-edit-rollback");
    fs::write(root.join("existing.ts"), "before").unwrap();
    fs::set_permissions(root.join("existing.ts"), fs::Permissions::from_mode(0o751)).unwrap();
    fs::write(root.join("script.sh"), "#!/bin/sh\n").unwrap();
    fs::set_permissions(root.join("script.sh"), fs::Permissions::from_mode(0o755)).unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("existing.ts", "after-", vec![]);
    edit.file_operations
        .push(LanguageServerWorkspaceFileOperation::Create {
            uri: "created.ts".into(),
            options: None,
        });
    edit.file_operations
        .push(LanguageServerWorkspaceFileOperation::Rename {
            old_uri: "script.sh".into(),
            new_uri: "moved.sh".into(),
            options: None,
        });
    edit.changes.insert(
        "created.ts".into(),
        relative_workspace_edit("created.ts", "created", vec![])
            .changes
            .remove("created.ts")
            .unwrap(),
    );

    let applied = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    )
    .unwrap();
    assert_eq!(applied.applied_count, 4);
    assert_eq!(
        fs::read_to_string(root.join("existing.ts")).unwrap(),
        "after-before"
    );
    assert_eq!(
        fs::read_to_string(root.join("created.ts")).unwrap(),
        "created"
    );
    assert_eq!(
        fs::metadata(root.join("moved.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o755,
    );

    fs::write(root.join("existing.ts"), "external").unwrap();
    let guarded_rollback = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        applied.rollback_edit.clone(),
        &[],
        &applied.rollback_expected_states,
        &applied.rollback_file_modes,
        |_, _| {},
    );
    assert!(guarded_rollback
        .expect_err("rollback must not overwrite a later external edit")
        .contains("changed after workspace edit commit"));
    assert_eq!(
        fs::read_to_string(root.join("existing.ts")).unwrap(),
        "external"
    );
    assert!(root.join("created.ts").exists());
    assert!(root.join("moved.sh").exists());
    fs::write(root.join("existing.ts"), "after-before").unwrap();

    apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        applied.rollback_edit,
        &[],
        &applied.rollback_expected_states,
        &applied.rollback_file_modes,
        |_, _| {},
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("existing.ts")).unwrap(),
        "before"
    );
    assert_eq!(
        fs::metadata(root.join("existing.ts"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o751,
    );
    assert!(!root.join("created.ts").exists());
    assert!(!root.join("moved.sh").exists());
    assert_eq!(
        fs::metadata(root.join("script.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o755,
    );
}

#[test]
fn transactional_overwrite_preserves_a_preexisting_hardlink_alias_and_rolls_back() {
    let root = temp_workspace("transactional-workspace-edit-hardlink-alias");
    let target = root.join("value.ts");
    let alias = root.join("legitimate-alias.ts");
    fs::write(&target, "before").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o751)).unwrap();
    fs::hard_link(&target, &alias).unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;

    let applied = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "after-", vec![]),
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    )
    .unwrap();

    assert_eq!(applied.applied_count, 1);
    assert_eq!(fs::read_to_string(&target).unwrap(), "after-before");
    assert_eq!(fs::read_to_string(&alias).unwrap(), "before");
    assert_eq!(
        fs::metadata(&alias).unwrap().permissions().mode() & 0o777,
        0o751
    );
    assert!(fs::read_dir(&root).unwrap().any(|entry| {
        let entry = entry.unwrap();
        entry
            .file_name()
            .to_string_lossy()
            .contains("codevo-recovery")
            && fs::read_to_string(entry.path()).is_ok_and(|content| content == "before")
            && entry
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o777 == 0o751)
    }));

    let rolled_back = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        applied.rollback_edit,
        &[],
        &applied.rollback_expected_states,
        &applied.rollback_file_modes,
        |_, _| {},
    )
    .unwrap();

    assert_eq!(rolled_back.applied_count, 1);
    assert_eq!(fs::read_to_string(&target).unwrap(), "before");
    assert_eq!(fs::read_to_string(&alias).unwrap(), "before");
    assert_eq!(
        fs::metadata(&alias).unwrap().permissions().mode() & 0o777,
        0o751
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transactional_same_content_overwrite_counts_and_rolls_back_mode_changes() {
    let root = temp_workspace("transactional-workspace-edit-mode-only-overwrite");
    fs::write(root.join("source.sh"), "same").unwrap();
    fs::write(root.join("target.sh"), "same").unwrap();
    fs::set_permissions(root.join("source.sh"), fs::Permissions::from_mode(0o644)).unwrap();
    fs::set_permissions(root.join("target.sh"), fs::Permissions::from_mode(0o755)).unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let edit = LanguageServerWorkspaceEdit {
        changes: BTreeMap::new(),
        document_versions: BTreeMap::new(),
        file_operations: vec![LanguageServerWorkspaceFileOperation::Rename {
            old_uri: "source.sh".into(),
            new_uri: "target.sh".into(),
            options: Some(LanguageServerWorkspaceFileOperationOptions {
                overwrite: Some(true),
                ..Default::default()
            }),
        }],
    };

    let applied = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    )
    .unwrap();

    assert_eq!(applied.applied_count, 2);
    assert!(!root.join("source.sh").exists());
    assert_eq!(fs::read_to_string(root.join("target.sh")).unwrap(), "same");
    assert_eq!(
        fs::metadata(root.join("target.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o644
    );

    let rolled_back = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        applied.rollback_edit,
        &[],
        &applied.rollback_expected_states,
        &applied.rollback_file_modes,
        |_, _| {},
    )
    .unwrap();
    assert_eq!(rolled_back.applied_count, 2);
    assert_eq!(fs::read_to_string(root.join("source.sh")).unwrap(), "same");
    assert_eq!(fs::read_to_string(root.join("target.sh")).unwrap(), "same");
    assert_eq!(
        fs::metadata(root.join("source.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o644
    );
    assert_eq!(
        fs::metadata(root.join("target.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o755
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transactional_workspace_edit_rejects_symlink_escape_before_mutation() {
    use std::os::unix::fs::symlink;

    let root = temp_workspace("transactional-workspace-edit-symlink");
    let outside = temp_workspace("transactional-workspace-edit-outside");
    fs::write(root.join("safe.ts"), "safe").unwrap();
    fs::write(outside.join("value.ts"), "outside").unwrap();
    symlink(&outside, root.join("link")).unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let mut edit = relative_workspace_edit("safe.ts", "changed-", vec![]);
    edit.changes
        .extend(relative_workspace_edit("link/value.ts", "changed-", vec![]).changes);

    let result = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    );

    assert!(result
        .expect_err("symlink must reject transaction")
        .contains("symbolic links"));
    assert_eq!(fs::read_to_string(root.join("safe.ts")).unwrap(), "safe");
    assert_eq!(
        fs::read_to_string(outside.join("value.ts")).unwrap(),
        "outside"
    );
}

#[test]
fn transactional_workspace_edit_keeps_the_retained_root_after_path_replacement() {
    let root = temp_workspace("transactional-workspace-edit-retained-root");
    let moved_root = root.with_extension("retained");
    fs::write(root.join("value.ts"), "original").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;

    apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "changed-", vec![]),
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, index| {
            if index == 0 && path == Path::new("value.ts") {
                fs::rename(&root, &moved_root).unwrap();
                fs::create_dir(&root).unwrap();
                fs::write(root.join("value.ts"), "replacement").unwrap();
            }
        },
    )
    .expect("the retained root descriptor must remain authoritative");

    assert_eq!(
        fs::read_to_string(moved_root.join("value.ts")).unwrap(),
        "changed-original"
    );
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "replacement"
    );
    assert!(fs::read_dir(&root).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("codevo-")));
    assert!(fs::read_dir(&moved_root).unwrap().all(|entry| {
        let name = entry.unwrap().file_name();
        let name = name.to_string_lossy();
        !name.contains("codevo-") || name.contains("codevo-recovery")
    }));
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(moved_root).unwrap();
}

#[test]
fn transactional_workspace_edit_keeps_preflight_parent_after_directory_swap() {
    let root = temp_workspace("transactional-workspace-edit-retained-parent");
    fs::create_dir(root.join("src")).unwrap();
    fs::write(root.join("src/value.ts"), "original").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;

    apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("src/value.ts", "changed-", vec![]),
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |path, index| {
            if index == 0 && path == Path::new("src/value.ts") {
                fs::rename(root.join("src"), root.join("retained-src")).unwrap();
                fs::create_dir(root.join("src")).unwrap();
                fs::write(root.join("src/value.ts"), "replacement").unwrap();
            }
        },
    )
    .expect("the preflight parent descriptor must remain authoritative");

    assert_eq!(
        fs::read_to_string(root.join("retained-src/value.ts")).unwrap(),
        "changed-original"
    );
    assert_eq!(
        fs::read_to_string(root.join("src/value.ts")).unwrap(),
        "replacement"
    );
    for directory in [root.join("src"), root.join("retained-src")] {
        assert!(fs::read_dir(directory).unwrap().all(|entry| {
            let name = entry.unwrap().file_name();
            let name = name.to_string_lossy();
            !name.contains("codevo-") || name.contains("codevo-recovery")
        }));
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transactional_workspace_edit_validates_auxiliary_paths_before_mutation() {
    let root = temp_workspace("transactional-workspace-edit-auxiliary-paths");
    fs::write(root.join("value.ts"), "original").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let edit = relative_workspace_edit("value.ts", "changed-", vec![]);

    let unsafe_skipped = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit.clone(),
        &["../outside.ts".into()],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    );
    assert!(unsafe_skipped
        .expect_err("unsafe skipped paths must be rejected")
        .contains("unsafe"));

    let unrelated_mode = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        edit,
        &[],
        &BTreeMap::new(),
        &BTreeMap::from([("unrelated.ts".into(), 0o600)]),
        |_, _| {},
    );
    assert!(unrelated_mode
        .expect_err("unrelated file modes must be rejected")
        .contains("outside the transaction"));

    let mut excessive_operations = relative_workspace_edit("value.ts", "changed-", vec![]);
    excessive_operations.file_operations = (0..=MAX_TRANSACTION_FILE_OPERATIONS)
        .map(|_| LanguageServerWorkspaceFileOperation::Create {
            uri: "value.ts".into(),
            options: None,
        })
        .collect();
    let excessive_operations = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        excessive_operations,
        &[],
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    );
    assert!(excessive_operations
        .expect_err("excessive repeated operations must be rejected")
        .contains("file-operation limit"));

    let excessive_skipped = vec!["value.ts".to_string(); MAX_TRANSACTION_AFFECTED_PATHS + 1];
    let excessive_skipped = apply_transactional_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "changed-", vec![]),
        &excessive_skipped,
        &BTreeMap::new(),
        &BTreeMap::new(),
        |_, _| {},
    );
    assert!(excessive_skipped
        .expect_err("skipped inputs must be capped before collection")
        .contains("path-entry limit"));
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "original"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transaction_cleanup_preserves_a_foreign_name_replacement() {
    let root = temp_workspace("transaction-cleanup-foreign-replacement");
    let parent = File::open(&root).unwrap();
    let name = CString::new(".value.codevo-stage-test").unwrap();
    fs::write(root.join(".value.codevo-stage-test"), "owned").unwrap();
    let owned = File::open(root.join(".value.codevo-stage-test")).unwrap();
    let expected = descriptor_file_identity(&owned).unwrap();
    fs::rename(
        root.join(".value.codevo-stage-test"),
        root.join("owned-retained"),
    )
    .unwrap();
    fs::write(root.join(".value.codevo-stage-test"), "foreign").unwrap();

    let error = guarded_descriptor_cleanup(&parent, &name, expected, "value.ts", 0)
        .expect_err("foreign replacement must not be unlinked");

    assert!(error.contains("foreign cleanup replacement"));
    assert_eq!(
        fs::read_to_string(root.join(".value.codevo-stage-test")).unwrap(),
        "foreign"
    );
    assert_eq!(
        fs::read_to_string(root.join("owned-retained")).unwrap(),
        "owned"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_success_retains_bounded_full_content_recovery_entries() {
    let root = temp_workspace("transaction-repeated-success-footprint");
    fs::write(root.join("value.ts"), "value").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;

    for _ in 0..32 {
        apply_transactional_descriptor_workspace_edit(
            &registry,
            &id,
            relative_workspace_edit("value.ts", "x", vec![]),
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
            |_, _| {},
        )
        .unwrap();
    }

    let recovery = fs::read_dir(&root)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .contains("codevo-recovery")
        })
        .collect::<Vec<_>>();
    assert_eq!(recovery.len(), 32);
    assert!(recovery
        .iter()
        .all(|entry| entry.metadata().unwrap().len() >= 5));
    assert_eq!(fs::metadata(root.join("value.ts")).unwrap().len(), 37);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preexisting_recovery_markers_reject_after_new_registry_admission() {
    const TEST_RECOVERY_LIMIT: usize = 16;
    let root = temp_workspace("transaction-persistent-recovery-admission");
    fs::write(root.join("value.ts"), "value").unwrap();
    for index in 0..TEST_RECOVERY_LIMIT {
        fs::write(
            root.join(format!(".foreign.codevo-recovery-1-{index}-0")),
            "",
        )
        .unwrap();
    }
    let restarted_registry = WorkspaceRegistry::new();
    let id = restarted_registry.register(&root).unwrap().workspace_id;

    let rejected = with_test_parent_transaction_recovery_limit(TEST_RECOVERY_LIMIT, || {
        apply_transactional_descriptor_workspace_edit(
            &restarted_registry,
            &id,
            relative_workspace_edit("value.ts", "changed-", vec![]),
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
            |_, _| {},
        )
    });

    assert!(rejected
        .expect_err("persistent recovery capacity must survive registry restart")
        .contains("manually inspect"));
    assert_eq!(fs::read_to_string(root.join("value.ts")).unwrap(), "value");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preexisting_recovery_bytes_reject_after_new_registry_admission() {
    const TEST_RECOVERY_BYTE_LIMIT: u64 = 32;
    let root = temp_workspace("transaction-persistent-recovery-byte-admission");
    fs::write(root.join("value.ts"), "value").unwrap();
    fs::write(
        root.join(".codevo-recovery-suspicious"),
        vec![b'x'; TEST_RECOVERY_BYTE_LIMIT as usize],
    )
    .unwrap();
    let restarted_registry = WorkspaceRegistry::new();
    let id = restarted_registry.register(&root).unwrap().workspace_id;

    let rejected =
        with_test_parent_transaction_recovery_byte_limit(TEST_RECOVERY_BYTE_LIMIT, || {
            apply_transactional_descriptor_workspace_edit(
                &restarted_registry,
                &id,
                relative_workspace_edit("value.ts", "changed-", vec![]),
                &[],
                &BTreeMap::new(),
                &BTreeMap::new(),
                |_, _| {},
            )
        });

    assert!(rejected
        .expect_err("persistent recovery byte capacity must survive registry restart")
        .contains("byte capacity"));
    assert_eq!(fs::read_to_string(root.join("value.ts")).unwrap(), "value");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transaction_terminal_cleanup_never_mutates_a_late_hardlink_alias() {
    let root = temp_workspace("transaction-cleanup-terminal-hardlink");
    let parent = File::open(&root).unwrap();
    let name = CString::new(".value.codevo-stage-test").unwrap();
    fs::write(root.join(".value.codevo-stage-test"), "owned").unwrap();
    fs::set_permissions(
        root.join(".value.codevo-stage-test"),
        fs::Permissions::from_mode(0o751),
    )
    .unwrap();
    let owned = File::open(root.join(".value.codevo-stage-test")).unwrap();
    let expected = descriptor_file_identity(&owned).unwrap();
    let hook_root = root.clone();

    guarded_descriptor_cleanup_with_terminal_hook(
        &parent,
        &name,
        expected,
        "value.ts",
        0,
        move |_, recovery_name| {
            let recovery_path = hook_root.join(OsStr::from_bytes(recovery_name.to_bytes()));
            fs::hard_link(recovery_path, hook_root.join("late-alias")).unwrap();
        },
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(root.join("late-alias")).unwrap(),
        "owned"
    );
    assert_eq!(
        fs::metadata(root.join("late-alias"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o751
    );
    assert!(fs::read_dir(&root).unwrap().any(|entry| {
        let entry = entry.unwrap();
        entry
            .file_name()
            .to_string_lossy()
            .contains("codevo-recovery")
            && fs::read_to_string(entry.path()).is_ok_and(|content| content == "owned")
            && entry
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o777 == 0o751)
    }));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transaction_terminal_cleanup_swap_never_unlinks_the_foreign_entry() {
    let root = temp_workspace("transaction-cleanup-terminal-swap");
    let parent = File::open(&root).unwrap();
    let name = CString::new(".value.codevo-stage-test").unwrap();
    fs::write(root.join(".value.codevo-stage-test"), "owned").unwrap();
    let owned = File::open(root.join(".value.codevo-stage-test")).unwrap();
    let expected = descriptor_file_identity(&owned).unwrap();
    let hook_root = root.clone();

    guarded_descriptor_cleanup_with_terminal_hook(
        &parent,
        &name,
        expected,
        "value.ts",
        0,
        move |_, recovery_name| {
            let recovery_path = hook_root.join(OsStr::from_bytes(recovery_name.to_bytes()));
            fs::rename(&recovery_path, hook_root.join("owned-retained")).unwrap();
            fs::write(recovery_path, "foreign-after-check").unwrap();
        },
    )
    .expect("terminal cleanup deliberately retains the recovery name");

    assert_eq!(
        fs::read_to_string(root.join("owned-retained")).unwrap(),
        "owned"
    );
    assert!(fs::read_dir(&root).unwrap().any(|entry| {
        let entry = entry.unwrap();
        entry
            .file_name()
            .to_string_lossy()
            .contains("codevo-recovery")
            && fs::read_to_string(entry.path()).unwrap() == "foreign-after-check"
    }));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn transaction_publish_abort_always_cleans_stage_and_retains_blocked_backup() {
    let root = temp_workspace("transaction-publish-abort-cleanup");
    let parent = File::open(&root).unwrap();
    let leaf_name = CString::new("value.ts").unwrap();
    let backup_name = CString::new(".value.ts.codevo-backup-test").unwrap();
    let stage_name = CString::new(".value.ts.codevo-stage-test").unwrap();
    fs::write(root.join("value.ts"), "foreign").unwrap();
    fs::write(root.join(".value.ts.codevo-backup-test"), "original").unwrap();
    fs::write(root.join(".value.ts.codevo-stage-test"), "staged").unwrap();
    let stage_path = DescriptorTransactionPath {
        leaf_name: stage_name.clone(),
        parent: parent.try_clone().unwrap(),
        relative_path: "value.ts".into(),
    };
    let stage_snapshot = descriptor_transaction_file_snapshot(&stage_path).unwrap();
    let staged = vec![StagedTransactionFile {
        parent: parent.try_clone().unwrap(),
        relative_path: "value.ts".into(),
        snapshot: stage_snapshot,
        temporary_name: stage_name,
    }];
    let path = DescriptorTransactionPath {
        leaf_name,
        parent,
        relative_path: "value.ts".into(),
    };

    let error = abort_transaction_current_path(
        &staged,
        &Vec::<CommittedTransactionPath>::new(),
        &path,
        Some(&backup_name),
        "publish failed".into(),
    );

    assert!(error.contains("original retained"));
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "foreign"
    );
    assert_eq!(
        fs::read_to_string(root.join(".value.ts.codevo-backup-test")).unwrap(),
        "original"
    );
    assert!(!root.join(".value.ts.codevo-stage-test").exists());
    assert!(fs::read_dir(&root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("codevo-recovery")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn descriptor_workspace_edit_reports_conflict_on_the_first_file() {
    let root = temp_workspace("descriptor-workspace-edit-first-conflict");
    fs::write(root.join("value.ts"), "value").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let result = apply_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "changed-", vec![]),
        &[],
        |_, _| fs::write(root.join("value.ts"), "external").unwrap(),
    );
    assert!(matches!(
        result,
        WorkspaceEditResult::Conflict {
            applied_count: 0,
            ..
        }
    ));
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "external"
    );
}

#[test]
fn descriptor_workspace_edit_does_not_save_or_count_no_op_edits() {
    let root = temp_workspace("descriptor-workspace-edit-no-op");
    fs::write(root.join("value.ts"), "value").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let result = apply_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "", vec![]),
        &[],
        |_, _| fs::write(root.join("value.ts"), "external").unwrap(),
    );
    assert!(matches!(
        result,
        WorkspaceEditResult::Success {
            applied_count: 0,
            ..
        }
    ));
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "external"
    );
}

#[test]
fn descriptor_workspace_edit_renames_with_overwrite() {
    let root = temp_workspace("descriptor-workspace-edit-rename-overwrite");
    fs::write(root.join("source.ts"), "source").unwrap();
    fs::write(root.join("target.ts"), "target").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let result = apply_descriptor_workspace_edit(
        &registry,
        &id,
        LanguageServerWorkspaceEdit {
            changes: BTreeMap::new(),
            document_versions: BTreeMap::new(),
            file_operations: vec![LanguageServerWorkspaceFileOperation::Rename {
                old_uri: "source.ts".into(),
                new_uri: "target.ts".into(),
                options: Some(LanguageServerWorkspaceFileOperationOptions {
                    overwrite: Some(true),
                    ..Default::default()
                }),
            }],
        },
        &[],
        |_, _| {},
    );
    assert!(matches!(
        result,
        WorkspaceEditResult::Success {
            applied_count: 1,
            ..
        }
    ));
    assert!(!root.join("source.ts").exists());
    assert_eq!(
        fs::read_to_string(root.join("target.ts")).unwrap(),
        "source"
    );
}

#[test]
fn descriptor_workspace_edit_unknown_workspace_is_not_found() {
    let registry = WorkspaceRegistry::new();
    let id: WorkspaceId = serde_json::from_str("\"missing\"").unwrap();
    let result = apply_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "value", vec![]),
        &[],
        |_, _| {},
    );
    assert!(matches!(result, WorkspaceEditResult::NotFound { .. }));
}

#[test]
fn descriptor_workspace_edit_honors_skipped_relative_paths() {
    let root = temp_workspace("descriptor-workspace-edit-skipped");
    fs::write(root.join("value.ts"), "original").unwrap();
    let registry = WorkspaceRegistry::new();
    let id = registry.register(&root).unwrap().workspace_id;
    let result = apply_descriptor_workspace_edit(
        &registry,
        &id,
        relative_workspace_edit("value.ts", "changed", vec![]),
        &["value.ts".into()],
        |_, _| {},
    );
    assert!(matches!(
        result,
        WorkspaceEditResult::Success {
            applied_count: 0,
            ..
        }
    ));
    assert_eq!(
        fs::read_to_string(root.join("value.ts")).unwrap(),
        "original"
    );
}

fn relative_workspace_edit(
    path: &str,
    new_text: &str,
    file_operations: Vec<LanguageServerWorkspaceFileOperation>,
) -> LanguageServerWorkspaceEdit {
    let mut changes = BTreeMap::new();
    changes.insert(
        path.into(),
        vec![LanguageServerTextEdit {
            range: LanguageServerRange {
                start: LanguageServerPosition {
                    line: 0,
                    character: 0,
                },
                end: LanguageServerPosition {
                    line: 0,
                    character: 0,
                },
            },
            new_text: new_text.into(),
        }],
    );
    LanguageServerWorkspaceEdit {
        changes,
        document_versions: BTreeMap::new(),
        file_operations,
    }
}

// The git, write-file, and apply-edit commands moved off the Tauri main
// thread (async fn + spawn_blocking) so save/tab-switch/push never stall the
// WebView. These tests drive the real async commands through the Tauri async
// runtime and assert behaviour is unchanged off-thread, that concurrent
// requests succeed, and that commands stay isolated per workspace root.

fn init_test_git_repo(root: &Path) {
    run_test_git(root, &["init"]);
    run_test_git(root, &["config", "user.email", "test@example.com"]);
    run_test_git(root, &["config", "user.name", "Test User"]);
}

fn run_test_git(root: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .expect("run git");
    assert!(status.success(), "git {args:?} failed");
}

fn test_git_output(root: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
