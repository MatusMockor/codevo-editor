use super::*;
use agent_history_scope::AGENT_HISTORY_SCOPE_MISMATCH_ERROR;
use std::os::unix::fs::symlink;

fn owner_id(root_key: &str) -> String {
    super::super::super::agent_attachment_commands::agent_thread_store::agent_root_owner_id(
        root_key,
    )
}

fn captured(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: &StartAgentTaskRequest,
) -> AgentTaskProjectAuthority {
    capture_agent_task_project_authority(registry, trust, request).expect("capture authority")
}

fn alias_registered_request(
    workspace: &TempWorkspace,
    alias: &Path,
) -> (
    WorkspaceRegistry,
    Mutex<WorkspaceTrustService>,
    StartAgentTaskRequest,
) {
    let registry = WorkspaceRegistry::new();
    let descriptor = registry.register(alias).expect("register selected alias");
    let mut trust =
        WorkspaceTrustService::load(workspace.root.join("trust.json")).expect("load trust service");
    trust
        .set(alias.to_str().expect("UTF-8 alias"), true)
        .expect("trust selected alias");
    let mut request = start_request(workspace, &workspace.root, AgentTaskIsolation::InPlace);
    request.workspace_id = descriptor.workspace_id;
    request.project_root = alias.to_string_lossy().into_owned();
    (registry, Mutex::new(trust), request)
}

#[test]
fn canonical_root_key_of_a_symlinked_project_equals_the_retained_project_authority() {
    let workspace = TempWorkspace::create("scope-symlinked");
    let alias_parent = TempWorkspace::create("scope-symlinked-alias");
    let alias = alias_parent.root.join("alias");
    symlink(&workspace.root, &alias).expect("create selected alias");
    let (registry, trust, request) = alias_registered_request(&workspace, &alias);
    let authority = captured(&registry, &trust, &request);

    for root_key in workspace_root_keys_of(&authority) {
        let canonical = fs::canonicalize(&root_key).expect("canonical root key");
        assert_eq!(canonical, authority.project_root, "{root_key}");
        assert!(
            retained_root_matches_path(&authority.project_authority, &canonical),
            "{root_key}"
        );
        let scope = bound_history_scope(&history_scope_for(&root_key), &authority)
            .unwrap_or_else(|error| panic!("{root_key}: {error}"));
        assert_eq!(scope.root_key, root_key);
        assert_eq!(scope.owner_id, owner_id(&root_key));
    }
    assert_eq!(
        workspace_root_keys_of(&authority),
        [
            alias.to_string_lossy().into_owned(),
            workspace.root.to_string_lossy().into_owned()
        ]
    );
}

fn workspace_root_keys_of(authority: &AgentTaskProjectAuthority) -> Vec<String> {
    agent_task_root_keys(authority)
}

#[test]
fn canonical_root_key_of_a_nested_repository_project_equals_the_retained_project_authority() {
    let workspace = TempWorkspace::create("scope-nested");
    let repository = workspace.root.join("packages/app");
    fs::create_dir_all(&repository).expect("create nested repository");
    let repository = repository
        .canonicalize()
        .expect("canonical nested repository");
    let (registry, trust, request) = registered_request(&workspace, &repository);
    let authority = captured(&registry, &trust, &request);
    assert_eq!(authority.repository_root, repository);

    let project_key = workspace.root.to_string_lossy().into_owned();
    assert_eq!(
        workspace_root_keys_of(&authority),
        std::slice::from_ref(&project_key)
    );
    assert_eq!(
        fs::canonicalize(&project_key).expect("canonical root key"),
        authority.project_root
    );
    let scope = bound_history_scope(&history_scope_for(&project_key), &authority)
        .expect("project scope of a nested repository turn");
    assert_eq!(scope.root_key, project_key);

    let repository_key = repository.to_string_lossy().into_owned();
    assert_eq!(
        bound_history_scope(&history_scope_for(&repository_key), &authority),
        Err(AGENT_HISTORY_SCOPE_MISMATCH_ERROR.to_string())
    );
}

#[test]
fn canonical_root_key_of_a_worktree_turn_equals_the_retained_project_authority() {
    let workspace = TempWorkspace::create("scope-worktree");
    let (registry, trust, mut request) = registered_request(&workspace, &workspace.root);
    let worktree = workspace.worktree("agt-test-0001");
    request.isolation = AgentTaskIsolation::Worktree;
    request.cwd = worktree.to_string_lossy().into_owned();
    trust
        .lock()
        .expect("trust lock")
        .set(&request.cwd, true)
        .expect("trust worktree");
    let authority = captured(&registry, &trust, &request);
    assert_eq!(authority.cwd, worktree);

    let project_key = workspace.root.to_string_lossy().into_owned();
    assert!(bound_history_scope(&history_scope_for(&project_key), &authority).is_ok());
    assert_eq!(
        bound_history_scope(&history_scope_for(&request.cwd), &authority),
        Err(AGENT_HISTORY_SCOPE_MISMATCH_ERROR.to_string())
    );
}

#[test]
fn unresolved_temporary_alias_of_the_project_root_is_the_same_scope() {
    let workspace = TempWorkspace::create("scope-temp-alias");
    let (registry, trust, request) = registered_request(&workspace, &workspace.root);
    let authority = captured(&registry, &trust, &request);
    let unresolved = std::env::temp_dir().join(workspace.root.file_name().expect("root name"));
    let unresolved_key = unresolved.to_string_lossy().into_owned();

    let scope = bound_history_scope(&history_scope_for(&unresolved_key), &authority)
        .expect("alias of the registered root");

    assert_eq!(scope.root_key, unresolved_key);
}

#[test]
fn history_scope_of_another_or_replaced_root_is_refused() {
    let workspace = TempWorkspace::create("scope-refused");
    let foreign = TempWorkspace::create("scope-refused-foreign");
    let (registry, trust, request) = registered_request(&workspace, &workspace.root);
    let authority = captured(&registry, &trust, &request);
    let project_key = workspace.root.to_string_lossy().into_owned();
    let refused = Err(AGENT_HISTORY_SCOPE_MISMATCH_ERROR.to_string());
    assert_eq!(
        AGENT_HISTORY_SCOPE_MISMATCH_ERROR,
        "Agent history scope does not match the workspace the task starts in."
    );

    let foreign_key = foreign.root.to_string_lossy().into_owned();
    assert_eq!(
        bound_history_scope(&history_scope_for(&foreign_key), &authority),
        refused
    );
    let mut foreign_owner = history_scope_for(&project_key);
    foreign_owner.owner_id = owner_id(&foreign_key);
    assert_eq!(bound_history_scope(&foreign_owner, &authority), refused);
    for malformed in ["", "relative/root", "/missing/codevo/history/scope", "/\n"] {
        assert_eq!(
            bound_history_scope(&history_scope_for(malformed), &authority),
            refused,
            "{malformed:?}"
        );
    }
    let oversized = format!("/{}", "a".repeat(4096));
    assert_eq!(
        bound_history_scope(&history_scope_for(&oversized), &authority),
        refused
    );

    let moved = workspace.root.with_extension("moved");
    fs::rename(&workspace.root, &moved).expect("move the registered root away");
    fs::create_dir(&workspace.root).expect("replace the registered root");
    let replaced = bound_history_scope(&history_scope_for(&project_key), &authority);
    fs::remove_dir(&workspace.root).expect("remove the replacement root");
    fs::rename(&moved, &workspace.root).expect("restore the registered root");
    assert_eq!(replaced, refused);
}

#[test]
fn start_request_requires_a_strict_history_scope() {
    let complete = r#"{"taskId":"agt-test-0001","workspaceId":"workspace-1","projectRoot":"/repo","repositoryRoot":"/repo","cwd":"/repo","isolation":"in-place","prompt":"do it","agentCliKind":"claudeCode","resumeSessionId":null,"launch":{"provider":"claudeCode","model":"opus","mode":"plan"},"providerGeneration":1,"threadId":"agt-thread-0001","historyScope":{"rootKey":"/repo","ownerId":"agent-root:repo"}}"#;
    let parsed: StartAgentTaskRequest =
        serde_json::from_str(complete).expect("complete request parses");
    assert_eq!(parsed.history_scope.root_key, "/repo");
    assert_eq!(parsed.history_scope.owner_id, "agent-root:repo");

    let scope = r#","historyScope":{"rootKey":"/repo","ownerId":"agent-root:repo"}"#;
    for replacement in [
        "",
        r#","historyScope":null"#,
        r#","historyScope":{"rootKey":"/repo"}"#,
        r#","historyScope":{"ownerId":"agent-root:repo"}"#,
        r#","historyScope":{"rootKey":"/repo","ownerId":"agent-root:repo","workspaceId":"w"}"#,
        r#","historyScope":{"root_key":"/repo","owner_id":"agent-root:repo"}"#,
        r#","historyScope":{"rootKey":7,"ownerId":"agent-root:repo"}"#,
    ] {
        let request = complete.replace(scope, replacement);
        assert_ne!(request, complete);
        assert!(
            serde_json::from_str::<StartAgentTaskRequest>(&request).is_err(),
            "{replacement}"
        );
    }
}
