use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_WORKSPACE: AtomicU64 = AtomicU64::new(0);

struct RefusingSpawner;

impl crate::agent_task_spawner::AgentProcessSpawner for RefusingSpawner {
    fn spawn(
        &self,
        _plan: &AgentTaskSpawnPlan,
    ) -> Result<Box<dyn crate::agent_task_spawner::AgentChild>, String> {
        Err("question command tests never spawn a child".to_string())
    }
}

struct SilentSink;

impl AgentTaskEventSink for SilentSink {
    fn status(&self, _event: AgentTaskStatusEvent) {}

    fn output(&self, _event: AgentTaskOutputEvent) {}
}

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn create(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-question-commands-{label}-{}-{}",
            std::process::id(),
            NEXT_WORKSPACE.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).expect("workspace root");
        Self {
            root: std::fs::canonicalize(root).expect("canonical workspace root"),
        }
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn tasks() -> AgentTaskRegistry {
    AgentTaskRegistry::new(
        Arc::new(AgentTaskAdmissionRegistry::new()),
        Arc::new(RefusingSpawner),
        Arc::new(SilentSink),
    )
}

fn owner(descriptor: &ManagedWorkspaceDescriptor, task_id: &str) -> QuestionOwner {
    QuestionOwner {
        task_id: task_id.to_string(),
        workspace_id: descriptor.workspace_id.clone(),
        repository_root: descriptor
            .canonical_root_path
            .to_string_lossy()
            .into_owned(),
    }
}

#[test]
fn a_registered_workspace_lists_no_requests_for_a_task_that_has_not_started() {
    let workspace = Workspace::create("not-started");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let tasks = tasks();
    let owner = owner(&descriptor, "agt-turn-not-started");
    assert_eq!(
        list_owned_questions(&workspaces, &tasks, &owner).map(|requests| requests.len()),
        Ok(0)
    );
    assert_eq!(
        list_owned_approvals(&workspaces, &tasks, &owner).map(|requests| requests.len()),
        Ok(0)
    );
}

#[test]
fn an_unregistered_workspace_cannot_list_requests() {
    let workspace = Workspace::create("unregistered");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    workspaces
        .unregister(&descriptor.workspace_id)
        .expect("unregister");
    let tasks = tasks();
    let owner = owner(&descriptor, "agt-turn-not-started");
    assert!(list_owned_questions(&workspaces, &tasks, &owner).is_err());
    assert!(list_owned_approvals(&workspaces, &tasks, &owner).is_err());
}

#[test]
fn a_replaced_workspace_generation_cannot_list_requests() {
    let workspace = Workspace::create("replaced");
    let workspaces = WorkspaceRegistry::new();
    let original = workspaces.register(&workspace.root).expect("register");
    workspaces
        .unregister(&original.workspace_id)
        .expect("unregister");
    let replacement = workspaces.register(&workspace.root).expect("reregister");
    assert_ne!(original.workspace_id, replacement.workspace_id);
    let tasks = tasks();
    let owner = owner(&original, "agt-turn-not-started");
    assert!(list_owned_questions(&workspaces, &tasks, &owner).is_err());
    assert!(list_owned_approvals(&workspaces, &tasks, &owner).is_err());
}

#[test]
fn a_workspace_cannot_list_requests_under_a_foreign_root() {
    let workspace = Workspace::create("owned-root");
    let foreign = Workspace::create("foreign-root");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let tasks = tasks();
    let mut owner = owner(&descriptor, "agt-turn-not-started");
    owner.repository_root = foreign.root.to_string_lossy().into_owned();
    assert_eq!(
        list_owned_questions(&workspaces, &tasks, &owner).map(|requests| requests.len()),
        Err("Question workspace changed.".to_string())
    );
    assert_eq!(
        list_owned_approvals(&workspaces, &tasks, &owner).map(|requests| requests.len()),
        Err("Question workspace changed.".to_string())
    );
}
