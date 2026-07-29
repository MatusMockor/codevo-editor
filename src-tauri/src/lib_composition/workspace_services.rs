use super::*;

pub(crate) fn build_php_language_server_plan(
    root_path: &str,
    trust: &Mutex<WorkspaceTrustService>,
    php_backend: Option<&str>,
    phpactor_path: Option<&str>,
    intelephense_path: Option<&str>,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(root_path);
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(root_path)
        .trusted;
    let descriptor = ComposerWorkspaceDetector::default()
        .detect(&root)
        .map_err(|error| error.to_string())?;
    let tools = LocalPhpToolDetector
        .detect(Some(&root))
        .map_err(|error| error.to_string())?;
    let settings =
        PhpLanguageServerSettings::from_options(php_backend, phpactor_path, intelephense_path);

    Ok(PhpactorLanguageServerPlanner::new().plan(&root, trusted, &descriptor, &tools, &settings))
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JavaScriptTypeScriptLanguageServerOptions {
    pub(crate) root_path: String,
    pub(crate) type_script_version_preference: Option<String>,
    pub(crate) auto_imports_enabled: Option<bool>,
    pub(crate) automatic_type_acquisition_enabled: Option<bool>,
    pub(crate) code_lens_enabled: Option<bool>,
    pub(crate) complete_function_calls: Option<bool>,
    pub(crate) import_module_specifier_ending: Option<String>,
    pub(crate) import_module_specifier_preference: Option<String>,
    pub(crate) inlay_hints_enabled: Option<bool>,
    pub(crate) prefer_type_only_auto_imports: Option<bool>,
    pub(crate) quote_preference: Option<String>,
    pub(crate) validation_enabled: Option<bool>,
}

pub(crate) struct JavaScriptTypeScriptLanguageServerRequest(
    pub(crate) JavaScriptTypeScriptLanguageServerOptions,
);

impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R>
    for JavaScriptTypeScriptLanguageServerRequest
{
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        let tauri::ipc::InvokeBody::Json(payload) = command.message.payload() else {
            return Err(tauri::Error::InvalidArgs(
                command.name,
                command.key,
                serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "language server options require a JSON payload",
                )),
            )
            .into());
        };
        serde_json::from_value(payload.clone())
            .map(Self)
            .map_err(|error| tauri::Error::InvalidArgs(command.name, command.key, error).into())
    }
}

#[tauri::command]
pub(crate) fn plan_php_language_server(
    root_path: String,
    php_backend: Option<String>,
    phpactor_path: Option<String>,
    intelephense_path: Option<String>,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<LanguageServerPlan, String> {
    build_php_language_server_plan(
        &root_path,
        &service,
        php_backend.as_deref(),
        phpactor_path.as_deref(),
        intelephense_path.as_deref(),
    )
}

#[tauri::command]
pub(crate) async fn plan_javascript_typescript_language_server(
    request: JavaScriptTypeScriptLanguageServerRequest,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<LanguageServerPlan, String> {
    let options = request.0;
    let root_path = options.root_path.clone();
    let trust_authority = capture_javascript_typescript_workspace_trust(&trust, &root_path)?;
    let trusted = trust_authority.trusted;
    let plan = run_blocking_command(move || {
        build_javascript_typescript_language_server_plan_with_trust(trusted, &options)
    })
    .await?;
    revalidate_javascript_typescript_workspace_trust(&trust, &trust_authority)?;
    Ok(plan)
}

#[tauri::command]
pub(crate) async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    // Directory listing hits the disk; keep it off the main thread so opening a
    // project (loadDirectory) cannot stall the WebView during index I/O.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .read_directory(&PathBuf::from(path))
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_text_file(path: String) -> Result<String, String> {
    // File reads (restored tabs at open) hit the disk; keep them off the main
    // thread to avoid WebView stalls while the indexer contends for disk I/O.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .read_text_file(&PathBuf::from(path))
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn search_files(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<FileSearchResult>, String> {
    // File-name search walks the workspace tree; keep it off the main thread.
    run_blocking_command(move || {
        let repository = LocalWorkspaceFileRepository;
        repository
            .search_files(&PathBuf::from(root), &query, limit)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn search_text(
    root: String,
    query: String,
    limit: usize,
    options: Option<TextSearchOptions>,
) -> Result<Vec<TextSearchResult>, String> {
    // Full-text search spawns ripgrep and reads its output; keep it off the main
    // thread so the WebView is not blocked while it runs. `options` is optional so
    // legacy 3-arg callers (no filters) keep the original literal, case-insensitive
    // behaviour.
    let options = options.unwrap_or_default();
    run_blocking_command(move || {
        let searcher = RipgrepTextSearcher;
        searcher
            .search(&PathBuf::from(root), &query, limit, &options)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn search_project_symbols(
    app: AppHandle,
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<ProjectSymbolSearchResult>, String> {
    // Opening the per-workspace SQLite index and scanning it (LIKE + ORDER BY)
    // is blocking and contends with the background indexer; resolve the root and
    // run the whole round-trip off the main thread. The captured `root` keeps
    // this request bound to its own workspace database (no cross-root leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let index = open_workspace_index(&app, &root)?;
        index
            .search_project_symbols(&query, limit)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_php_tree(app: AppHandle, root: String) -> Result<PhpTree, String> {
    // Loading the full workspace symbol tree is a large SQLite read; resolve the
    // requested root and run it off the main thread against that root's database
    // only.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let index = open_workspace_index(&app, &root)?;
        index.load_php_tree().map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_php_file_outline(
    app: AppHandle,
    root: String,
    path: String,
) -> Result<PhpFileOutline, String> {
    // Path resolution + the per-file SQLite read both block; resolve the root
    // and run them off the main thread, scoped to the requested workspace.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root)?;
        let path = resolve_workspace_path(&root, &path)?;
        let index = open_workspace_index(&app, &root)?;
        index
            .load_php_file_outline(&path.to_string_lossy())
            .map_err(|error| error.to_string())
    })
    .await
}

#[cfg(not(test))]
pub(crate) type GitTrustState<'a> = State<'a, Mutex<WorkspaceTrustService>>;
#[cfg(test)]
pub(crate) type GitTrustState<'a> = bool;

#[cfg(not(test))]
pub(crate) fn trusted_for(trust: &GitTrustState<'_>, root_path: &str) -> Result<bool, String> {
    Ok(trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(root_path)
        .trusted)
}

#[cfg(test)]
pub(crate) fn trusted_for(trust: &GitTrustState<'_>, _root_path: &str) -> Result<bool, String> {
    Ok(*trust)
}

// Rejects a local-history relative path that is absolute or escapes the
// workspace via `..`, so a snapshot/version request can never address content
// outside the requested workspace root (per-workspace isolation).
pub(crate) fn ensure_local_history_relative_path(relative_path: &str) -> Result<(), String> {
    // Normalize Windows separators so `..` traversal expressed with backslashes
    // (which Path::components on Unix would treat as a single filename) is still
    // detected. The store hashes the same normalized form, so this keeps the
    // guard and the storage key in agreement.
    if relative_path.is_empty() || relative_path.contains('\0') {
        return Err("Local history path must name a workspace file.".to_string());
    }

    let normalized = relative_path.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.ends_with('/')
        || normalized.contains("//")
        || normalized
            .split('/')
            .any(|component| component == "." || component == "..")
        || normalized
            .split('/')
            .next()
            .is_some_and(|component| component.ends_with(':'))
    {
        return Err("Local history path must be an unambiguous relative path.".to_string());
    }
    let path = Path::new(&normalized);

    if path.is_absolute() {
        return Err("Local history path must be workspace-relative.".to_string());
    }

    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("Local history path must stay inside the workspace.".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn record_local_history_snapshot(
    app: AppHandle,
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<Option<LocalHistoryVersion>, String> {
    // Writing a snapshot touches disk (index + content file); keep it off the
    // main thread. The captured `root_path` + `relative_path` bind the snapshot
    // to its own workspace bucket and file (no cross-root or cross-file leak).
    run_blocking_command(move || {
        ensure_local_history_relative_path(&relative_path)?;
        let storage_root = app
            .state::<LegacyLocalHistoryWorkspaceAuthorizer>()
            .authorize(&app.state::<WorkspaceRegistry>(), &root_path)?;
        let store = local_history_store(&app)?;
        store.record_snapshot(&storage_root, &relative_path, &content)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_local_history_versions(
    app: AppHandle,
    root_path: String,
    relative_path: String,
) -> Result<Vec<LocalHistoryVersion>, String> {
    // Reading the version index is cheap but still touches disk; keep it off the
    // main thread and scope it to the requested workspace + file.
    run_blocking_command(move || {
        ensure_local_history_relative_path(&relative_path)?;
        let storage_root = app
            .state::<LegacyLocalHistoryWorkspaceAuthorizer>()
            .authorize(&app.state::<WorkspaceRegistry>(), &root_path)?;
        let store = local_history_store(&app)?;
        store.list_versions(&storage_root, &relative_path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_local_history_version_content(
    app: AppHandle,
    root_path: String,
    relative_path: String,
    version_id: String,
) -> Result<String, String> {
    // Reads one snapshot's stored content off the main thread, scoped to the
    // requested workspace + file + version.
    run_blocking_command(move || {
        ensure_local_history_relative_path(&relative_path)?;
        let storage_root = app
            .state::<LegacyLocalHistoryWorkspaceAuthorizer>()
            .authorize(&app.state::<WorkspaceRegistry>(), &root_path)?;
        let store = local_history_store(&app)?;
        store.read_version(&storage_root, &relative_path, &version_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_file_commit_diff(
    root_path: String,
    relative_path: String,
    sha: String,
    trust: GitTrustState<'_>,
) -> Result<GitFileDiff, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Reading both blob revisions for a historical commit shells out to `git
    // show` twice; keep the round-trip off the main thread. The captured
    // `root_path`, `relative_path`, and `sha` bind the request to its own
    // repository, file, and revision (no cross-root or cross-file leakage). The
    // gateway validates `relative_path` and `sha` before they reach git.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .file_commit_diff(&root, &relative_path, &sha)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn stage_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Staging shells out to `git add` then re-reads status; keep the round-trip
    // off the main thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .stage(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn unstage_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Unstaging shells out to `git` and re-reads status; keep it off the main
    // thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .unstage(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_file_hunks(
    root_path: String,
    relative_path: String,
    staged: bool,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitDiffHunk>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Reads a single file's `git diff` off the main thread, bound to the
    // requested repository root and file (no cross-root/file leakage).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .file_hunks(&root, &relative_path, staged)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn stage_git_hunk(
    root_path: String,
    relative_path: String,
    hunk_index: u32,
    expected_identity: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Staging one hunk runs `git diff` + `git apply --cached` and re-reads
    // status; keep the round-trip off the main thread, bound to the requested
    // repository root. A rejected patch fails atomically (index untouched).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .stage_hunk(&root, &relative_path, hunk_index, &expected_identity)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn unstage_git_hunk(
    root_path: String,
    relative_path: String,
    hunk_index: u32,
    expected_identity: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Unstaging one hunk runs `git diff --cached` + `git apply --cached
    // --reverse` and re-reads status; keep it off the main thread, bound to the
    // requested repository root. A rejected patch fails atomically.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .unstage_hunk(&root, &relative_path, hunk_index, &expected_identity)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn revert_git_hunk(
    root_path: String,
    relative_path: String,
    hunk_index: u32,
    expected_identity: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Reverting one hunk runs `git diff` + `git apply --reverse` and re-reads
    // status off the main thread. The identity fence and Git's atomic apply
    // make a stale request a safe worktree no-op; the index is never targeted.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .revert_hunk(&root, &relative_path, hunk_index, &expected_identity)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn revert_git_files(
    root_path: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Reverting shells out to `git checkout`/`restore` and re-reads status; keep
    // it off the main thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .revert(&root, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn commit_git_changes(
    root_path: String,
    message: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Committing runs several `git` subprocesses (write-tree, commit-tree, ...);
    // keep the whole sequence off the main thread, bound to the requested
    // repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .commit(&root, &message, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn amend_git_commit(
    root_path: String,
    message: String,
    changes: Vec<GitChangedFile>,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .amend(&root, &message, &changes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn reword_git_commit(
    root_path: String,
    commit_hash: String,
    message: String,
    trust: GitTrustState<'_>,
) -> Result<GitCommit, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .reword(&root, &commit_hash, &message)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn push_git_changes(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git push` performs network I/O and can block for seconds; it MUST run off
    // the main thread so the WebView stays responsive. Bound to the requested
    // repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .push(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn fetch_git_changes(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .fetch(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn pull_git_changes(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<GitStatus, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .pull(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_git_stash(
    root_path: String,
    message: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git stash push` shells out and rewrites the working tree; keep it off the
    // main thread, bound to the requested repository root (no cross-root leak).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .stash_save(&root, &message)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_stash_list(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitStashEntry>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Listing stashes shells out to `git stash list`; keep it off the main
    // thread, scoped to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .stash_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn stash_apply_git(
    root_path: String,
    index: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Applying a stash rewrites the working tree; keep it off the main thread,
    // bound to the requested repository root. The index is validated numerically
    // before it reaches the `stash@{N}` selector (no option/revision injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway::new(trusted)
            .stash_apply(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn stash_pop_git(
    root_path: String,
    index: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Popping a stash applies then drops it; keep it off the main thread, bound
    // to the requested repository root. The index is validated numerically.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway::new(trusted)
            .stash_pop(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_stash_diff(
    root_path: String,
    index: String,
    trust: GitTrustState<'_>,
) -> Result<String, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git stash show -p` shells out to produce a diff; keep it off the main
    // thread, bound to the requested repository root. The index is validated
    // numerically before it reaches the `stash@{N}` selector.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway::new(trusted)
            .stash_show(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn stash_drop_git(
    root_path: String,
    index: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Dropping a stash is destructive; keep it off the main thread, bound to the
    // requested repository root. The index is validated numerically before it
    // reaches the `stash@{N}` selector (no option/revision injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        let index = safe_stash_index(&index).map_err(|error| error.to_string())?;
        CommandGitRepositoryGateway::new(trusted)
            .stash_drop(&root, index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_git_branches(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBranch>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Listing branches shells out to `git for-each-ref`; keep it off the main
    // thread, scoped to the requested repository root (no cross-root leak).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .branch_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_git_remote_branches(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBranch>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .remote_branch_list(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn checkout_git_remote_branch(
    root_path: String,
    name: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitBranch>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .checkout_remote_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_current_branch(
    root_path: String,
    trust: GitTrustState<'_>,
) -> Result<Option<String>, String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // Resolving the current branch shells out to git; keep it off the main
    // thread, bound to the requested repository root.
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .current_branch(&root)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_git_branch(
    root_path: String,
    name: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git branch <name>` creates a branch WITHOUT switching (the working tree is
    // never touched). Keep it off the main thread, bound to the requested root.
    // The name is validated against git's own ref grammar before it reaches the
    // subprocess (no option/shell injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .create_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_git_branch(
    root_path: String,
    name: String,
    force: bool,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .delete_branch(&root, &name, force)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_git_branch(
    root_path: String,
    old_name: String,
    new_name: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .rename_branch(&root, &old_name, &new_name)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn switch_git_branch(
    root_path: String,
    name: String,
    trust: GitTrustState<'_>,
) -> Result<(), String> {
    let trusted = trusted_for(&trust, &root_path)?;
    // `git switch <name>` (no `-f`/`--discard`) rewrites the working tree but
    // refuses when local changes would be overwritten, so no work is ever lost.
    // Keep it off the main thread, bound to the requested repository root. The
    // name is validated against git's ref grammar (no option/shell injection).
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&root_path)?;
        CommandGitRepositoryGateway::new(trusted)
            .switch_branch(&root, &name)
            .map_err(|error| error.to_string())
    })
    .await
}
