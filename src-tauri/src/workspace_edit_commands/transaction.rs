#[tauri::command]
pub(crate) async fn apply_workspace_edit(
    root_path: String,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: Vec<String>,
) -> Result<usize, String> {
    // A cross-file rename/refactor writes an unbounded number of files in a
    // loop; run the whole apply off the main thread, scoped to the requested
    // workspace root (path guard rejects anything outside it).
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        ensure_lsp_workspace_edit_paths_in_workspace(&root_path, &edit)?;
        let file_operation_count =
            apply_workspace_file_operations(&repository, &edit.file_operations)?;
        let edits = workspace_text_edits_from_language_server(edit)?;

        let text_edit_count = apply_text_edits_to_files(&repository, &edits, &skipped_paths)
            .map_err(|error| error.to_string())?;

        Ok(file_operation_count + text_edit_count)
    })
    .await
}

#[tauri::command]
pub(crate) async fn workspace_apply_workspace_edit(
    app: AppHandle,
    workspace_id: WorkspaceId,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: Vec<String>,
) -> Result<WorkspaceEditResult, String> {
    run_blocking_command(move || {
        let registry = app.state::<WorkspaceRegistry>();
        Ok(apply_descriptor_workspace_edit(
            &registry,
            &workspace_id,
            edit,
            &skipped_paths,
            |_, _| {},
        ))
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionalWorkspaceEditResult {
    pub(crate) applied_count: usize,
    pub(crate) rollback_edit: LanguageServerWorkspaceEdit,
    pub(crate) rollback_expected_states: BTreeMap<String, Option<String>>,
    pub(crate) rollback_file_modes: BTreeMap<String, u32>,
}

#[derive(Clone)]
pub(crate) struct TransactionFileSnapshot {
    content: Option<Vec<u8>>,
    mode: Option<u32>,
    fingerprint: Option<TransactionFileFingerprint>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct TransactionFileFingerprint {
    device: u64,
    inode: u64,
    modified_nanoseconds: i128,
    size: u64,
    link_count: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct TransactionFileIdentity {
    fingerprint: TransactionFileFingerprint,
    mode: u32,
}

pub(crate) struct StagedTransactionFile {
    pub(crate) parent: File,
    pub(crate) relative_path: String,
    pub(crate) snapshot: TransactionFileSnapshot,
    pub(crate) temporary_name: CString,
}

pub(crate) struct CommittedTransactionPath {
    pub(crate) backup_name: Option<CString>,
    pub(crate) backup_snapshot: Option<TransactionFileSnapshot>,
    pub(crate) committed_snapshot: TransactionFileSnapshot,
    pub(crate) leaf_name: CString,
    pub(crate) parent: File,
    pub(crate) relative_path: String,
}

pub(crate) struct DescriptorTransactionPath {
    pub(crate) leaf_name: CString,
    pub(crate) parent: File,
    pub(crate) relative_path: String,
}

pub(crate) struct TransactionalWorkspaceEditRequest<'a> {
    pub(crate) edit: LanguageServerWorkspaceEdit,
    pub(crate) expected_states: &'a BTreeMap<String, Option<String>>,
    pub(crate) file_modes: &'a BTreeMap<String, u32>,
    pub(crate) skipped_paths: &'a [String],
}

pub(crate) const MAX_TRANSACTION_AFFECTED_PATHS: usize = 512;
pub(crate) const MAX_TRANSACTION_FILE_OPERATIONS: usize = 512;
const MAX_TRANSACTION_TEXT_EDITS: usize = 4096;
const MAX_TRANSACTION_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_TRANSACTION_EXISTING_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TRANSACTION_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
// POSIX has no compare-and-unlink primitive. A transaction can therefore retain at most one
// recovery entry per stage, backup, and rollback artifact instead of risking deletion of a
// name-swapped foreign file: <= 4 * affected paths (including link-recovery fallback) and
// <= existing + 2 * output byte budgets of writer-owned storage.
const MAX_TRANSACTION_RECOVERY_FILES: usize = MAX_TRANSACTION_AFFECTED_PATHS * 4;
const MAX_TRANSACTION_RECOVERY_BYTES: u64 =
    MAX_TRANSACTION_EXISTING_BYTES + (MAX_TRANSACTION_OUTPUT_BYTES as u64 * 2);
const MAX_PROCESS_TRANSACTION_RECOVERY_ENTRIES: usize = 65_536;
const MAX_PROCESS_TRANSACTION_RECOVERY_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_PARENT_TRANSACTION_RECOVERY_ENTRIES: usize = 8_192;
const MAX_PARENT_TRANSACTION_RECOVERY_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RECOVERY_DIRECTORY_SCAN_ENTRIES: usize = 16_384;
// P2 UX: surface these retained markers for guided manual inspection and cleanup. Automatic
// deletion remains intentionally disabled until it can prove inode identity atomically.
static PROCESS_TRANSACTION_RECOVERY_RESERVATIONS: AtomicUsize = AtomicUsize::new(0);
static PROCESS_TRANSACTION_RECOVERY_BYTE_RESERVATIONS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
thread_local! {
    static TEST_PARENT_TRANSACTION_RECOVERY_LIMIT: Cell<Option<usize>> = const { Cell::new(None) };
    static TEST_PARENT_TRANSACTION_RECOVERY_BYTE_LIMIT: Cell<Option<u64>> = const { Cell::new(None) };
}

struct TransactionRecoveryReservation {
    count: usize,
    bytes: u64,
}

impl Drop for TransactionRecoveryReservation {
    fn drop(&mut self) {
        PROCESS_TRANSACTION_RECOVERY_RESERVATIONS.fetch_sub(self.count, Ordering::AcqRel);
        PROCESS_TRANSACTION_RECOVERY_BYTE_RESERVATIONS.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

#[tauri::command]
pub(crate) async fn workspace_apply_workspace_edit_transaction(
    app: AppHandle,
    workspace_id: WorkspaceId,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: Vec<String>,
    expected_states: BTreeMap<String, Option<String>>,
    file_modes: BTreeMap<String, u32>,
) -> Result<TransactionalWorkspaceEditResult, String> {
    run_blocking_command(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        apply_trusted_transactional_descriptor_workspace_edit(
            &registry,
            &trust,
            &workspace_id,
            TransactionalWorkspaceEditRequest {
                edit,
                expected_states: &expected_states,
                file_modes: &file_modes,
                skipped_paths: &skipped_paths,
            },
        )
    })
    .await
}

/// Acquires workspace authorities in the process-wide order: registry operations, trust, then
/// (when exposed) semantic CAS. The trust guard intentionally remains live through the commit so
/// a revocation cannot split authorization from mutation.
pub(crate) fn apply_trusted_transactional_descriptor_workspace_edit(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    workspace_id: &WorkspaceId,
    request: TransactionalWorkspaceEditRequest<'_>,
) -> Result<TransactionalWorkspaceEditResult, String> {
    let _operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let descriptor = registry
        .descriptor(workspace_id)
        .map_err(|error| error.to_string())?;
    let retained_root = registry
        .clone_root(workspace_id)
        .map_err(|error| error.to_string())?;
    let trust_guard = trust.lock().map_err(|error| error.to_string())?;
    let root_key = descriptor.canonical_root_path.to_string_lossy();
    if !trust_guard.get(&root_key).trusted {
        return Err("Trust this workspace before applying a workspace edit.".into());
    }

    apply_transactional_descriptor_workspace_edit_under_operation_lock(
        &retained_root,
        request.edit,
        request.skipped_paths,
        request.expected_states,
        request.file_modes,
    )
}

#[cfg(test)]
pub(crate) fn apply_trusted_transactional_descriptor_workspace_edit_with_hooks(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    workspace_id: &WorkspaceId,
    request: TransactionalWorkspaceEditRequest<'_>,
    after_operation_lock: impl FnOnce(),
    before_commit: impl FnMut(&Path, usize),
) -> Result<TransactionalWorkspaceEditResult, String> {
    let _operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    after_operation_lock();
    let descriptor = registry
        .descriptor(workspace_id)
        .map_err(|error| error.to_string())?;
    let retained_root = registry
        .clone_root(workspace_id)
        .map_err(|error| error.to_string())?;
    let trust_guard = trust.lock().map_err(|error| error.to_string())?;
    let root_key = descriptor.canonical_root_path.to_string_lossy();
    if !trust_guard.get(&root_key).trusted {
        return Err("Trust this workspace before applying a workspace edit.".into());
    }
    apply_transactional_descriptor_workspace_edit_under_operation_lock_with_hook(
        &retained_root,
        request.edit,
        request.skipped_paths,
        request.expected_states,
        request.file_modes,
        before_commit,
    )
}

#[cfg(test)]
pub(crate) fn apply_transactional_descriptor_workspace_edit(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    expected_states: &BTreeMap<String, Option<String>>,
    file_modes: &BTreeMap<String, u32>,
    before_commit: impl FnMut(&Path, usize),
) -> Result<TransactionalWorkspaceEditResult, String> {
    let _operation = registry
        .lock_operations()
        .map_err(|error| error.to_string())?;
    let retained_root = registry
        .clone_root(workspace_id)
        .map_err(|error| error.to_string())?;
    apply_transactional_descriptor_workspace_edit_under_operation_lock_with_hook(
        &retained_root,
        edit,
        skipped_paths,
        expected_states,
        file_modes,
        before_commit,
    )
}

fn apply_transactional_descriptor_workspace_edit_under_operation_lock(
    retained_root: &File,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    expected_states: &BTreeMap<String, Option<String>>,
    file_modes: &BTreeMap<String, u32>,
) -> Result<TransactionalWorkspaceEditResult, String> {
    #[cfg(test)]
    let before_commit = &mut |_: &Path, _: usize| {};
    apply_transactional_descriptor_workspace_edit_implementation(
        retained_root,
        edit,
        skipped_paths,
        expected_states,
        file_modes,
        #[cfg(test)]
        before_commit,
    )
}

#[cfg(test)]
fn apply_transactional_descriptor_workspace_edit_under_operation_lock_with_hook(
    retained_root: &File,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    expected_states: &BTreeMap<String, Option<String>>,
    file_modes: &BTreeMap<String, u32>,
    mut before_commit: impl FnMut(&Path, usize),
) -> Result<TransactionalWorkspaceEditResult, String> {
    apply_transactional_descriptor_workspace_edit_implementation(
        retained_root,
        edit,
        skipped_paths,
        expected_states,
        file_modes,
        &mut before_commit,
    )
}

fn apply_transactional_descriptor_workspace_edit_implementation(
    retained_root: &File,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    expected_states: &BTreeMap<String, Option<String>>,
    file_modes: &BTreeMap<String, u32>,
    #[cfg(test)] before_commit: &mut dyn FnMut(&Path, usize),
) -> Result<TransactionalWorkspaceEditResult, String> {
    validate_transaction_request_shape(&edit, skipped_paths, expected_states, file_modes)?;
    let skipped = skipped_paths.iter().cloned().collect::<BTreeSet<_>>();
    let affected_paths = transaction_affected_paths(&edit, &skipped)?;
    validate_transaction_request_bounds(
        &edit,
        skipped_paths,
        expected_states,
        file_modes,
        &affected_paths,
    )?;
    let transaction_paths = open_descriptor_transaction_paths(retained_root, &affected_paths)?;
    let mut original = BTreeMap::new();
    let mut existing_bytes = 0_u64;

    for relative_path in &affected_paths {
        let path = &transaction_paths[relative_path];
        if let Some(metadata) = descriptor_transaction_metadata(path)? {
            existing_bytes = existing_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "Workspace edit existing-byte budget overflowed.".to_string())?;
            if existing_bytes > MAX_TRANSACTION_EXISTING_BYTES {
                return Err("Workspace edit existing-byte budget exceeded.".to_string());
            }
        }
    }
    let mut snapshot_bytes = 0_u64;
    for relative_path in &affected_paths {
        let path = &transaction_paths[relative_path];
        let remaining = MAX_TRANSACTION_EXISTING_BYTES.saturating_sub(snapshot_bytes);
        let snapshot = descriptor_transaction_file_snapshot_bounded(
            path,
            usize::try_from(remaining).unwrap_or(usize::MAX),
        )?;
        snapshot_bytes = snapshot_bytes
            .checked_add(
                snapshot
                    .content
                    .as_ref()
                    .map_or(0, |content| content.len() as u64),
            )
            .ok_or_else(|| "Workspace edit existing-byte budget overflowed.".to_string())?;
        original.insert(relative_path.clone(), snapshot);
    }
    validate_transaction_expected_states(&original, expected_states)?;

    let mut final_state = original
        .iter()
        .map(|(path, snapshot)| (path.clone(), snapshot.content.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut final_modes = original
        .iter()
        .map(|(path, snapshot)| (path.clone(), snapshot.mode))
        .collect::<BTreeMap<_, _>>();
    apply_transaction_file_operations(&mut final_state, &mut final_modes, &edit.file_operations)?;
    apply_transaction_text_changes(&mut final_state, &edit, &skipped)?;
    validate_transaction_output_bounds(&final_state)?;

    let changed_paths = final_state
        .iter()
        .filter_map(|(path, content)| {
            let content_changed = original
                .get(path)
                .and_then(|snapshot| snapshot.content.as_ref())
                != content.as_ref();
            let desired_mode = file_modes
                .get(path)
                .copied()
                .or_else(|| final_modes.get(path).copied().flatten());
            let mode_changed = content.is_some() && original[path].mode != desired_mode;
            (content_changed || mode_changed).then_some(path.clone())
        })
        .collect::<Vec<_>>();
    let rollback_edit = rollback_workspace_edit(&original, &final_state, &changed_paths)?;
    let rollback_file_modes = changed_paths
        .iter()
        .filter_map(|path| original[path].mode.map(|mode| (path.clone(), mode)))
        .collect();
    let rollback_expected_states = changed_paths
        .iter()
        .map(|path| {
            (
                path.clone(),
                final_state
                    .get(path)
                    .and_then(Option::as_ref)
                    .map(|content| transaction_content_hash(content)),
            )
        })
        .collect();
    let recovery_bytes =
        transaction_recovery_reservation_bytes(&original, &final_state, &changed_paths)?;
    validate_persistent_transaction_recovery_capacity(
        &transaction_paths,
        &original,
        &final_state,
        &changed_paths,
    )?;
    let _recovery_reservation =
        reserve_transaction_recovery_capacity(changed_paths.len(), recovery_bytes)?;
    let mut staged = stage_transaction_files(
        &transaction_paths,
        &final_state,
        &final_modes,
        file_modes,
        &changed_paths,
    )?;
    let mut committed = Vec::new();

    for (index, relative_path) in changed_paths.iter().enumerate() {
        #[cfg(test)]
        before_commit(Path::new(relative_path), index);
        let path = &transaction_paths[relative_path];
        if let Err(error) =
            revalidate_descriptor_transaction_snapshot(path, &original[relative_path])
        {
            return Err(abort_transaction_commit(&staged, &committed, error));
        }
        let desired = final_state.get(relative_path).cloned().flatten();
        let stage_index = staged
            .iter()
            .position(|entry| entry.relative_path == *relative_path);
        let staged_snapshot = stage_index.map(|stage_index| staged[stage_index].snapshot.clone());
        if let (Some(stage_index), Some(expected_stage)) = (stage_index, staged_snapshot.as_ref()) {
            let staged_file = &staged[stage_index];
            let current_stage = descriptor_named_snapshot(
                &staged_file.parent,
                &staged_file.temporary_name,
                relative_path,
            );
            if !matches!(
                current_stage,
                Ok(ref current) if transaction_snapshots_match(current, expected_stage)
            ) {
                return Err(abort_transaction_commit(
                    &staged,
                    &committed,
                    format!("{relative_path}: staged file changed before transaction commit"),
                ));
            }
        }
        let backup_name = match transaction_temporary_name(path, "backup", index) {
            Ok(backup_name) => backup_name,
            Err(error) => {
                return Err(abort_transaction_commit(&staged, &committed, error));
            }
        };
        let had_original = original[relative_path].content.is_some();
        let committed_parent = path.parent.try_clone().map_err(|error| {
            abort_transaction_commit(
                &staged,
                &committed,
                format!("{relative_path}: retained parent is unavailable: {error}"),
            )
        })?;

        if had_original {
            if let Err(error) =
                descriptor_rename(&path.parent, &path.leaf_name, &path.parent, &backup_name)
            {
                return Err(abort_transaction_commit(
                    &staged,
                    &committed,
                    format!("{relative_path}: {error}"),
                ));
            }
            let backup = descriptor_named_snapshot(&path.parent, &backup_name, relative_path);
            if !matches!(
                backup,
                Ok(ref current)
                    if transaction_snapshots_match(current, &original[relative_path])
            ) {
                let restore =
                    descriptor_rename(&path.parent, &backup_name, &path.parent, &path.leaf_name)
                        .map_err(|error| {
                            format!(
                                "; original retained at {}: {error}",
                                backup_name.to_string_lossy()
                            )
                        });
                cleanup_staged_transaction_files(&staged);
                let rollback = rollback_committed_transaction_paths(&committed)
                    .err()
                    .map(|error| format!("; {error}"))
                    .unwrap_or_default();
                return Err(format!(
                    "{relative_path}: file changed during transaction commit{}{}",
                    restore.err().unwrap_or_default(),
                    rollback
                ));
            }
        }

        let mut committed_snapshot = TransactionFileSnapshot {
            content: None,
            mode: None,
            fingerprint: None,
        };
        if desired.is_some() {
            let stage_index = match stage_index {
                Some(stage_index) => stage_index,
                None => {
                    return Err(abort_transaction_current_path(
                        &staged,
                        &committed,
                        path,
                        had_original.then_some(&backup_name),
                        format!("{relative_path}: staged content is unavailable"),
                    ));
                }
            };
            let staged_file = staged.swap_remove(stage_index);
            committed_snapshot = match staged_snapshot {
                Some(snapshot) => snapshot,
                None => {
                    staged.push(staged_file);
                    return Err(abort_transaction_current_path(
                        &staged,
                        &committed,
                        path,
                        had_original.then_some(&backup_name),
                        format!("{relative_path}: staged snapshot is unavailable"),
                    ));
                }
            };
            if let Err(error) = descriptor_rename(
                &staged_file.parent,
                &staged_file.temporary_name,
                &path.parent,
                &path.leaf_name,
            ) {
                staged.push(staged_file);
                return Err(abort_transaction_current_path(
                    &staged,
                    &committed,
                    path,
                    had_original.then_some(&backup_name),
                    format!("{relative_path}: {error}"),
                ));
            }
        }

        committed.push(CommittedTransactionPath {
            backup_name: had_original.then_some(backup_name),
            backup_snapshot: had_original.then(|| original[relative_path].clone()),
            committed_snapshot,
            leaf_name: path.leaf_name.clone(),
            parent: committed_parent,
            relative_path: relative_path.clone(),
        });
    }

    cleanup_staged_transaction_files(&staged);
    for (index, entry) in committed.iter().enumerate() {
        if let (Some(backup_name), Some(backup_snapshot)) =
            (&entry.backup_name, &entry.backup_snapshot)
        {
            let Some(expected) = transaction_snapshot_identity(backup_snapshot) else {
                continue;
            };
            if let Err(error) = guarded_descriptor_cleanup(
                &entry.parent,
                backup_name,
                expected,
                &entry.relative_path,
                index,
            ) {
                eprintln!("Workspace edit backup cleanup failed: {error}");
            }
        }
    }

    Ok(TransactionalWorkspaceEditResult {
        applied_count: changed_paths.len(),
        rollback_edit,
        rollback_expected_states,
        rollback_file_modes,
    })
}

fn validate_transaction_expected_states(
    actual: &BTreeMap<String, TransactionFileSnapshot>,
    expected: &BTreeMap<String, Option<String>>,
) -> Result<(), String> {
    for (path, expected_hash) in expected {
        let Some(snapshot) = actual.get(path) else {
            return Err(format!(
                "{path}: rollback precondition path was not validated"
            ));
        };
        let actual_hash = snapshot
            .content
            .as_ref()
            .map(|content| transaction_content_hash(content));
        if &actual_hash != expected_hash {
            return Err(format!("{path}: file changed after workspace edit commit"));
        }
    }
    Ok(())
}

fn transaction_content_hash(content: &[u8]) -> String {
    let hash = content.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    hash.to_string()
}

fn validate_transaction_request_shape(
    edit: &LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    expected_states: &BTreeMap<String, Option<String>>,
    file_modes: &BTreeMap<String, u32>,
) -> Result<(), String> {
    if edit.changes.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || edit.document_versions.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || skipped_paths.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || expected_states.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || file_modes.len() > MAX_TRANSACTION_AFFECTED_PATHS
    {
        return Err("Workspace edit path-entry limit exceeded.".to_string());
    }
    if edit.file_operations.len() > MAX_TRANSACTION_FILE_OPERATIONS {
        return Err("Workspace edit file-operation limit exceeded.".to_string());
    }
    let text_edit_count = edit.changes.values().try_fold(0_usize, |count, edits| {
        count
            .checked_add(edits.len())
            .ok_or_else(|| "Workspace edit text-edit count overflowed.".to_string())
    })?;
    if text_edit_count > MAX_TRANSACTION_TEXT_EDITS {
        return Err("Workspace edit text-edit limit exceeded.".to_string());
    }
    let mut bytes = 0_usize;
    let mut validate = |path: &str, extra: usize| -> Result<(), String> {
        validate_transaction_relative_path(path)?;
        bytes = bytes
            .checked_add(path.len())
            .and_then(|bytes| bytes.checked_add(extra))
            .ok_or_else(|| "Workspace edit request-byte budget overflowed.".to_string())?;
        if bytes > MAX_TRANSACTION_REQUEST_BYTES {
            return Err("Workspace edit request-byte budget exceeded.".to_string());
        }
        Ok(())
    };
    for (path, edits) in &edit.changes {
        validate(
            path,
            edits
                .iter()
                .try_fold(0_usize, |total, edit| {
                    total.checked_add(edit.new_text.len())
                })
                .ok_or_else(|| "Workspace edit request-byte budget overflowed.".to_string())?,
        )?;
    }
    for path in edit.document_versions.keys() {
        validate(path, 0)?;
    }
    for operation in &edit.file_operations {
        match operation {
            LanguageServerWorkspaceFileOperation::Create { uri, .. }
            | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => validate(uri, 0)?,
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri, new_uri, ..
            } => {
                validate(old_uri, 0)?;
                validate(new_uri, 0)?;
            }
        }
    }
    for path in skipped_paths {
        validate(path, 0)?;
    }
    for (path, hash) in expected_states {
        validate(path, hash.as_ref().map_or(0, String::len))?;
    }
    for path in file_modes.keys() {
        validate(path, 0)?;
    }
    Ok(())
}

fn validate_transaction_request_bounds(
    edit: &LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    expected_states: &BTreeMap<String, Option<String>>,
    file_modes: &BTreeMap<String, u32>,
    affected_paths: &BTreeSet<String>,
) -> Result<(), String> {
    if affected_paths.len() > MAX_TRANSACTION_AFFECTED_PATHS {
        return Err("Workspace edit affected-path limit exceeded.".to_string());
    }
    if edit.changes.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || edit.document_versions.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || expected_states.len() > MAX_TRANSACTION_AFFECTED_PATHS
        || file_modes.len() > MAX_TRANSACTION_AFFECTED_PATHS
    {
        return Err("Workspace edit path-entry limit exceeded.".to_string());
    }
    if edit.file_operations.len() > MAX_TRANSACTION_FILE_OPERATIONS {
        return Err("Workspace edit file-operation limit exceeded.".to_string());
    }
    let text_edit_count = edit.changes.values().try_fold(0_usize, |count, edits| {
        count
            .checked_add(edits.len())
            .ok_or_else(|| "Workspace edit text-edit count overflowed.".to_string())
    })?;
    if text_edit_count > MAX_TRANSACTION_TEXT_EDITS {
        return Err("Workspace edit text-edit limit exceeded.".to_string());
    }
    let mut bytes = 0_usize;
    let mut add = |amount: usize| -> Result<(), String> {
        bytes = bytes
            .checked_add(amount)
            .ok_or_else(|| "Workspace edit request-byte budget overflowed.".to_string())?;
        if bytes > MAX_TRANSACTION_REQUEST_BYTES {
            return Err("Workspace edit request-byte budget exceeded.".to_string());
        }
        Ok(())
    };
    for (path, edits) in &edit.changes {
        add(path.len())?;
        for edit in edits {
            add(edit.new_text.len())?;
        }
    }
    for path in edit.document_versions.keys() {
        validate_transaction_relative_path(path)?;
        add(path.len())?;
    }
    for operation in &edit.file_operations {
        match operation {
            LanguageServerWorkspaceFileOperation::Create { uri, .. }
            | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => add(uri.len())?,
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri, new_uri, ..
            } => {
                add(old_uri.len())?;
                add(new_uri.len())?;
            }
        }
    }
    if skipped_paths.len() > MAX_TRANSACTION_AFFECTED_PATHS {
        return Err("Workspace edit skipped-path limit exceeded.".to_string());
    }
    for path in skipped_paths {
        validate_transaction_relative_path(path)?;
        add(path.len())?;
    }
    for (path, hash) in expected_states {
        validate_transaction_relative_path(path)?;
        if !affected_paths.contains(path) {
            return Err(format!(
                "{path}: rollback precondition path is outside the transaction"
            ));
        }
        add(path.len())?;
        if let Some(hash) = hash {
            add(hash.len())?;
        }
    }
    for path in file_modes.keys() {
        validate_transaction_relative_path(path)?;
        if !affected_paths.contains(path) {
            return Err(format!("{path}: file mode path is outside the transaction"));
        }
        add(path.len())?;
    }
    Ok(())
}

fn validate_transaction_output_bounds(
    final_state: &BTreeMap<String, Option<Vec<u8>>>,
) -> Result<(), String> {
    let output_bytes = final_state.values().try_fold(0_usize, |total, content| {
        total
            .checked_add(content.as_ref().map_or(0, Vec::len))
            .ok_or_else(|| "Workspace edit output-byte budget overflowed.".to_string())
    })?;
    if output_bytes > MAX_TRANSACTION_OUTPUT_BYTES {
        return Err("Workspace edit output-byte budget exceeded.".to_string());
    }
    Ok(())
}

fn reserve_transaction_recovery_capacity(
    changed_path_count: usize,
    bytes: u64,
) -> Result<TransactionRecoveryReservation, String> {
    let reservation = changed_path_count
        .checked_mul(4)
        .ok_or_else(|| "Workspace edit recovery reservation overflowed.".to_string())?;
    PROCESS_TRANSACTION_RECOVERY_BYTE_RESERVATIONS
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current
                .checked_add(bytes)
                .filter(|next| *next <= MAX_PROCESS_TRANSACTION_RECOVERY_BYTES)
        })
        .map_err(|_| {
            "Workspace edit recovery capacity is exhausted; retained recovery markers require operator cleanup before more closed-file transactions."
                .to_string()
        })?;
    if PROCESS_TRANSACTION_RECOVERY_RESERVATIONS
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current
                .checked_add(reservation)
                .filter(|next| *next <= MAX_PROCESS_TRANSACTION_RECOVERY_ENTRIES)
        })
        .is_err()
    {
        PROCESS_TRANSACTION_RECOVERY_BYTE_RESERVATIONS.fetch_sub(bytes, Ordering::AcqRel);
        return Err(
            "Workspace edit recovery capacity is exhausted; retained recovery markers require operator cleanup before more closed-file transactions."
                .to_string(),
        );
    }
    Ok(TransactionRecoveryReservation {
        count: reservation,
        bytes,
    })
}

fn transaction_recovery_reservation_bytes(
    original: &BTreeMap<String, TransactionFileSnapshot>,
    final_state: &BTreeMap<String, Option<Vec<u8>>>,
    changed_paths: &[String],
) -> Result<u64, String> {
    changed_paths.iter().try_fold(0_u64, |total, path| {
        let existing = original[path]
            .content
            .as_ref()
            .map_or(0_u64, |content| content.len() as u64);
        let output = final_state[path]
            .as_ref()
            .map_or(0_u64, |content| content.len() as u64);
        total
            .checked_add(existing)
            .and_then(|total| total.checked_add(output.checked_mul(2)?))
            .ok_or_else(|| "Workspace edit recovery byte reservation overflowed.".to_string())
    })
}

fn validate_persistent_transaction_recovery_capacity(
    paths: &BTreeMap<String, DescriptorTransactionPath>,
    original: &BTreeMap<String, TransactionFileSnapshot>,
    final_state: &BTreeMap<String, Option<Vec<u8>>>,
    changed_paths: &[String],
) -> Result<(), String> {
    let mut parents = BTreeMap::<(u64, u64), (&File, usize, u64)>::new();
    for relative_path in changed_paths {
        let path = &paths[relative_path];
        let metadata = path
            .parent
            .metadata()
            .map_err(|error| format!("{relative_path}: retained parent is unavailable: {error}"))?;
        let entry = parents
            .entry((metadata.dev(), metadata.ino()))
            .or_insert((&path.parent, 0, 0));
        entry.1 = entry
            .1
            .checked_add(4)
            .ok_or_else(|| "Workspace edit recovery reservation overflowed.".to_string())?;
        let existing = original[relative_path]
            .content
            .as_ref()
            .map_or(0_u64, |content| content.len() as u64);
        let output = final_state[relative_path]
            .as_ref()
            .map_or(0_u64, |content| content.len() as u64);
        entry.2 = entry
            .2
            .checked_add(existing)
            .and_then(|bytes| bytes.checked_add(output.checked_mul(2)?))
            .ok_or_else(|| "Workspace edit recovery byte reservation overflowed.".to_string())?;
    }
    for (_, (parent, entry_reservation, byte_reservation)) in parents {
        let existing = descriptor_recovery_usage(parent)?;
        if existing
            .entries
            .checked_add(entry_reservation)
            .filter(|count| *count <= parent_transaction_recovery_limit())
            .is_none()
        {
            return Err(
                "Workspace edit recovery capacity is exhausted in a retained parent; manually inspect verified codevo recovery entries before retrying."
                    .to_string(),
            );
        }
        if existing
            .bytes
            .checked_add(byte_reservation)
            .filter(|bytes| *bytes <= parent_transaction_recovery_byte_limit())
            .is_none()
        {
            return Err(
                "Workspace edit recovery byte capacity is exhausted in a retained parent; manually inspect verified codevo recovery entries before retrying."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn parent_transaction_recovery_limit() -> usize {
    #[cfg(test)]
    let limit = TEST_PARENT_TRANSACTION_RECOVERY_LIMIT
        .with(|limit| limit.get())
        .unwrap_or(MAX_PARENT_TRANSACTION_RECOVERY_ENTRIES);
    #[cfg(not(test))]
    let limit = MAX_PARENT_TRANSACTION_RECOVERY_ENTRIES;
    limit
}

fn parent_transaction_recovery_byte_limit() -> u64 {
    #[cfg(test)]
    let limit = TEST_PARENT_TRANSACTION_RECOVERY_BYTE_LIMIT
        .with(|limit| limit.get())
        .unwrap_or(MAX_PARENT_TRANSACTION_RECOVERY_BYTES);
    #[cfg(not(test))]
    let limit = MAX_PARENT_TRANSACTION_RECOVERY_BYTES;
    limit
}

#[cfg(test)]
pub(crate) fn with_test_parent_transaction_recovery_limit<T>(
    limit: usize,
    operation: impl FnOnce() -> T,
) -> T {
    TEST_PARENT_TRANSACTION_RECOVERY_LIMIT.with(|override_limit| {
        let previous = override_limit.replace(Some(limit));
        let result = operation();
        override_limit.set(previous);
        result
    })
}

#[cfg(test)]
pub(crate) fn with_test_parent_transaction_recovery_byte_limit<T>(
    limit: u64,
    operation: impl FnOnce() -> T,
) -> T {
    TEST_PARENT_TRANSACTION_RECOVERY_BYTE_LIMIT.with(|override_limit| {
        let previous = override_limit.replace(Some(limit));
        let result = operation();
        override_limit.set(previous);
        result
    })
}

struct TransactionRecoveryUsage {
    entries: usize,
    bytes: u64,
}

struct DescriptorDirectoryStream(*mut libc::DIR);

impl Drop for DescriptorDirectoryStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

fn descriptor_recovery_usage(parent: &File) -> Result<TransactionRecoveryUsage, String> {
    let duplicated = unsafe { libc::fcntl(parent.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
    if duplicated < 0 {
        return Err(format!(
            "Retained recovery parent is unavailable: {}",
            io::Error::last_os_error()
        ));
    }
    let directory = unsafe { libc::fdopendir(duplicated) };
    if directory.is_null() {
        unsafe {
            libc::close(duplicated);
        }
        return Err(format!(
            "Retained recovery parent cannot be enumerated: {}",
            io::Error::last_os_error()
        ));
    }
    let _directory = DescriptorDirectoryStream(directory);
    let mut visited = 0_usize;
    let mut recovery = TransactionRecoveryUsage {
        entries: 0,
        bytes: 0,
    };
    loop {
        set_errno(0);
        let entry = unsafe { libc::readdir(directory) };
        if entry.is_null() {
            let error = current_errno();
            return if error == 0 {
                Ok(recovery)
            } else {
                Err(format!(
                    "Retained recovery parent enumeration failed: {}",
                    io::Error::from_raw_os_error(error)
                ))
            };
        }
        visited = visited
            .checked_add(1)
            .ok_or_else(|| "Recovery directory scan count overflowed.".to_string())?;
        if visited > MAX_RECOVERY_DIRECTORY_SCAN_ENTRIES {
            return Err("Recovery directory scan limit exceeded.".to_string());
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if transaction_recovery_name_class(name).is_some() {
            recovery.entries = recovery
                .entries
                .checked_add(1)
                .ok_or_else(|| "Recovery entry count overflowed.".to_string())?;
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            let mut named_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            let stat_result = unsafe {
                libc::fstatat(
                    parent.as_raw_fd(),
                    name.as_ptr(),
                    named_stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            if stat_result != 0 {
                return Err(format!(
                    "Retained recovery entry cannot be measured safely: {}",
                    io::Error::last_os_error()
                ));
            }
            let named_stat = unsafe { named_stat.assume_init() };
            if named_stat.st_mode & libc::S_IFMT != libc::S_IFREG {
                return Err(
                    "Retained recovery entry is not a regular file; recovery byte capacity is conservatively exhausted."
                        .to_string(),
                );
            }
            let name = CString::new(name.to_bytes())
                .map_err(|_| "Retained recovery entry name is invalid.".to_string())?;
            let file = descriptor_openat(
                parent,
                &name,
                libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
            .map_err(|error| format!("Retained recovery entry cannot be opened safely: {error}"))?;
            let metadata = file.metadata().map_err(|error| {
                format!("Retained recovery entry cannot be measured safely: {error}")
            })?;
            if !metadata.file_type().is_file()
                || metadata.dev() != named_stat.st_dev as u64
                || metadata.ino() != named_stat.st_ino
                || metadata.len() != named_stat.st_size as u64
            {
                return Err(
                    "Retained recovery entry changed during measurement; recovery byte capacity is conservatively exhausted."
                        .to_string(),
                );
            }
            recovery.bytes = recovery
                .bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "Recovery byte count overflowed.".to_string())?;
        }
    }
}

enum TransactionRecoveryNameClass {
    OwnedSchema,
    SuspiciousLookalike,
}

fn transaction_recovery_name_class(name: &[u8]) -> Option<TransactionRecoveryNameClass> {
    const MARKER: &[u8] = b".codevo-recovery-";
    let marker_index = name
        .windows(MARKER.len())
        .rposition(|part| part == MARKER)?;
    if name.first() != Some(&b'.') {
        return None;
    }
    if marker_index == 0 {
        return Some(TransactionRecoveryNameClass::SuspiciousLookalike);
    }
    let suffix = &name[marker_index + MARKER.len()..];
    let mut fields = suffix.split(|byte| *byte == b'-');
    let exact = (0..3).all(|_| {
        fields
            .next()
            .is_some_and(|field| !field.is_empty() && field.iter().all(u8::is_ascii_digit))
    }) && fields.next().is_none();
    Some(if exact {
        TransactionRecoveryNameClass::OwnedSchema
    } else {
        TransactionRecoveryNameClass::SuspiciousLookalike
    })
}

#[cfg(target_os = "macos")]
fn set_errno(value: i32) {
    unsafe {
        *libc::__error() = value;
    }
}

#[cfg(target_os = "linux")]
fn set_errno(value: i32) {
    unsafe {
        *libc::__errno_location() = value;
    }
}

#[cfg(target_os = "macos")]
fn current_errno() -> i32 {
    unsafe { *libc::__error() }
}

#[cfg(target_os = "linux")]
fn current_errno() -> i32 {
    unsafe { *libc::__errno_location() }
}

fn transaction_affected_paths(
    edit: &LanguageServerWorkspaceEdit,
    skipped: &BTreeSet<String>,
) -> Result<BTreeSet<String>, String> {
    let mut paths = BTreeSet::new();
    for path in edit.changes.keys().filter(|path| !skipped.contains(*path)) {
        paths.insert(path.clone());
        if paths.len() > MAX_TRANSACTION_AFFECTED_PATHS {
            return Err("Workspace edit affected-path limit exceeded.".to_string());
        }
    }
    for operation in &edit.file_operations {
        match operation {
            LanguageServerWorkspaceFileOperation::Create { uri, .. }
            | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => {
                paths.insert(uri.clone());
            }
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri, new_uri, ..
            } => {
                paths.insert(old_uri.clone());
                paths.insert(new_uri.clone());
            }
        }
        if paths.len() > MAX_TRANSACTION_AFFECTED_PATHS {
            return Err("Workspace edit affected-path limit exceeded.".to_string());
        }
    }
    for path in &paths {
        validate_transaction_relative_path(path)?;
    }
    Ok(paths)
}

fn validate_transaction_relative_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(format!(
            "{}: workspace edit path must be relative",
            path.display()
        ));
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("{}: workspace edit path is unsafe", path.display()));
    }
    Ok(())
}
