use super::super::super::agent_attachment_commands::agent_thread_store::agent_root_owner_id;
use super::super::super::agent_history_commands::agent_history_store::runtime_requests::HistoryRuntimeRequestStore;
use super::*;
use crate::agent_questions::{
    AgentQuestion, AgentQuestionRequest, AgentQuestionSession, AgentQuestionStatus,
};
use crate::agent_runtime_requests::journal::{system_clock, RuntimeRequestJournal, TurnTracking};
use crate::agent_runtime_requests::projection::STALE_THREAD_REQUESTS_CURSOR_ERROR;
use crate::agent_runtime_requests::store::RuntimeRequestStore;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);
const FLUSH: Duration = Duration::from_secs(10);
const THREAD: &str = "agt-thread-0001";
const TURN: &str = "agt-turn-0001";

struct Directory {
    root: PathBuf,
}

impl Directory {
    fn create(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-request-commands-{label}-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).expect("directory");
        Self {
            root: std::fs::canonicalize(root).expect("canonical directory"),
        }
    }

    fn key(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct Window {
    history: Directory,
    workspaces: WorkspaceRegistry,
    leases: AgentRootLeaseRegistry,
    journal: Arc<RuntimeRequestJournal>,
    projection: RequestProjection,
    asked: Vec<(Arc<AgentQuestionSession>, TurnTracking)>,
}

fn scope_of(project: &Directory) -> HistoryScope {
    let root_key = project.key();
    HistoryScope {
        owner_id: agent_root_owner_id(&root_key),
        root_key,
    }
}

fn query(project: &Directory, thread_id: &str, cursor: Option<&str>) -> ThreadRequestsQuery {
    let scope = scope_of(project);
    ThreadRequestsQuery {
        root_key: scope.root_key,
        owner_id: scope.owner_id,
        thread_id: thread_id.to_string(),
        turn_ids: vec![TURN.to_string()],
        cursor: cursor.map(str::to_string),
    }
}

impl Window {
    fn open() -> Self {
        let history = Directory::create("history");
        let journal = Arc::new(RuntimeRequestJournal::start(
            Arc::new(HistoryRuntimeRequestStore::new(history.root.clone())),
            "boot-0001".to_string(),
            system_clock(),
        ));
        Self {
            history,
            workspaces: WorkspaceRegistry::new(),
            leases: AgentRootLeaseRegistry::new(),
            projection: RequestProjection::new(Arc::clone(&journal)),
            journal,
            asked: Vec::new(),
        }
    }

    fn ask(&mut self, project: &Directory, thread_id: &str) {
        let tracking = self
            .journal
            .track_turn(&scope_of(project), thread_id, TURN)
            .expect("track the turn");
        let session = Arc::new(AgentQuestionSession::new());
        let registered = session.register(
            AgentQuestionRequest {
                id: "question-1".into(),
                task_id: String::new(),
                provider: "codex".into(),
                questions: vec![AgentQuestion {
                    id: "notes".into(),
                    header: String::new(),
                    prompt: "Anything else to consider?".into(),
                    options: Vec::new(),
                    multiple: false,
                    allow_custom: true,
                }],
                status: AgentQuestionStatus::Pending,
                answers: None,
            },
            Arc::new(|_| Ok(())),
        );
        assert_eq!(registered, Ok(()));
        self.journal.observe(
            Some(&tracking.task_scope()),
            thread_id,
            session.snapshot(TURN, "ws-0001"),
        );
        assert!(self.journal.flush(FLUSH));
        self.asked.push((session, tracking));
    }

    fn pull(&self, query: &ThreadRequestsQuery) -> Result<Vec<String>, String> {
        let page = owned_thread_requests(&self.workspaces, &self.leases, &self.projection, query)?;
        let encoded = serde_json::to_value(&page).expect("encode the page");
        let decoded: ThreadRequests = serde_json::from_value(encoded["message"].clone())
            .expect("the message obeys the wire contract");
        assert_eq!(decoded, page.message);
        assert_eq!(encoded["nextCursor"], Value::Null);
        assert_eq!(encoded["message"]["workspaceId"], Value::Null);
        assert!(!encoded.to_string().contains(&query.root_key));
        assert!(!encoded.to_string().contains(&query.owner_id));
        Ok(page
            .message
            .parts()
            .requests
            .iter()
            .map(|request| request.parts().id.clone())
            .collect())
    }
}

fn unowned() -> Result<Vec<String>, String> {
    Err(UNOWNED_THREAD_REQUESTS_ROOT_ERROR.to_string())
}

#[test]
fn pull_serves_an_open_project_and_refuses_foreign_roots_and_owners() {
    let mut window = Window::open();
    let (open, closed) = (Directory::create("open"), Directory::create("closed"));
    window.workspaces.register(&open.root).expect("register");
    window.ask(&open, THREAD);
    window.ask(&closed, "agt-thread-0002");

    assert_eq!(
        window.pull(&query(&open, THREAD, None)),
        Ok(vec!["question-1".to_string()])
    );

    assert_eq!(
        window.pull(&query(&closed, "agt-thread-0002", None)),
        unowned()
    );
    let foreign_owner = ThreadRequestsQuery {
        owner_id: scope_of(&closed).owner_id,
        ..query(&open, THREAD, None)
    };
    assert_eq!(window.pull(&foreign_owner), unowned());
    for root_key in ["", "relative/project", "/nonexistent/codevo-project", "/"] {
        let elsewhere = ThreadRequestsQuery {
            root_key: root_key.to_string(),
            owner_id: agent_root_owner_id(root_key),
            ..query(&open, THREAD, None)
        };
        assert_eq!(window.pull(&elsewhere), unowned(), "{root_key}");
    }
    let nested = open.root.join("nested");
    std::fs::create_dir_all(&nested).expect("nested directory");
    let nested_key = nested.to_string_lossy().into_owned();
    let below = ThreadRequestsQuery {
        owner_id: agent_root_owner_id(&nested_key),
        root_key: nested_key,
        ..query(&open, THREAD, None)
    };
    assert_eq!(window.pull(&below), unowned());
}

#[test]
fn project_is_served_only_while_this_window_has_it_open() {
    let mut window = Window::open();
    let (first, second) = (Directory::create("first"), Directory::create("second"));
    let opened = window.workspaces.register(&first.root).expect("register");
    window.ask(&first, THREAD);
    let asked = Ok(vec!["question-1".to_string()]);
    assert_eq!(window.pull(&query(&first, THREAD, None)), asked);

    window
        .workspaces
        .unregister(&opened.workspace_id)
        .expect("close the first project");
    let replaced = window.workspaces.register(&second.root).expect("register");

    assert_eq!(window.pull(&query(&first, THREAD, None)), unowned());
    assert_eq!(window.pull(&query(&second, THREAD, None)), Ok(Vec::new()));

    window
        .workspaces
        .unregister(&replaced.workspace_id)
        .expect("close the second project");
    window.workspaces.register(&first.root).expect("reopen");
    assert_eq!(window.pull(&query(&first, THREAD, None)), asked);
    assert_eq!(window.pull(&query(&second, THREAD, None)), unowned());
}

#[test]
fn thread_journaled_under_another_project_is_never_served_through_this_one() {
    let mut window = Window::open();
    let (own, other) = (Directory::create("own"), Directory::create("other"));
    window.workspaces.register(&own.root).expect("register");
    window.workspaces.register(&other.root).expect("register");
    window.ask(&other, THREAD);

    assert_eq!(window.pull(&query(&own, THREAD, None)), Ok(Vec::new()));

    assert_eq!(
        window.pull(&query(&other, THREAD, None)),
        Ok(vec!["question-1".to_string()])
    );
}

#[test]
fn project_root_leased_to_an_open_workspace_is_served() {
    let mut window = Window::open();
    let (workspace, project) = (Directory::create("worktree"), Directory::create("project"));
    window.ask(&project, THREAD);
    assert_eq!(window.pull(&query(&project, THREAD, None)), unowned());
    let opened = window
        .workspaces
        .register(&workspace.root)
        .expect("register");
    let registration = AgentRootWorkspaceRegistration {
        workspace_id: opened.workspace_id.clone(),
        admission_token: 1,
    };
    window
        .leases
        .acquire_registered(&project.root, registration)
        .expect("lease the project root");

    assert_eq!(
        window.pull(&query(&project, THREAD, None)),
        Ok(vec!["question-1".to_string()])
    );

    window
        .workspaces
        .unregister(&opened.workspace_id)
        .expect("close the workspace");
    assert_eq!(window.pull(&query(&project, THREAD, None)), unowned());
}

#[test]
fn malformed_queries_and_stale_cursors_are_errors() {
    let mut window = Window::open();
    let project = Directory::create("project");
    window.workspaces.register(&project.root).expect("register");
    window.ask(&project, THREAD);
    let scope = scope_of(&project);
    let request = json!({
        "rootKey": scope.root_key,
        "ownerId": scope.owner_id,
        "threadId": THREAD,
        "turnIds": [TURN],
        "cursor": null,
    });
    let parsed: ThreadRequestsQuery =
        serde_json::from_value(request.clone()).expect("the contract");
    assert_eq!(window.pull(&parsed), Ok(vec!["question-1".to_string()]));
    let mut unknown = request.clone();
    unknown["workspaceId"] = json!("ws-0001");
    assert!(serde_json::from_value::<ThreadRequestsQuery>(unknown).is_err());
    let mut untyped = request.clone();
    untyped["turnIds"] = json!("agt-turn-0001");
    assert!(serde_json::from_value::<ThreadRequestsQuery>(untyped).is_err());
    let mut omitted = request;
    omitted.as_object_mut().expect("an object").remove("cursor");
    assert!(serde_json::from_value::<ThreadRequestsQuery>(omitted).is_err());

    let too_many = ThreadRequestsQuery {
        turn_ids: (0..33)
            .map(|index| format!("agt-turn-{index:04}"))
            .collect(),
        ..query(&project, THREAD, None)
    };
    let invalid = Err(INVALID_THREAD_REQUESTS_QUERY_ERROR.to_string());
    assert_eq!(window.pull(&too_many), invalid);
    let oversized = "c".repeat(MAX_CURSOR_BYTES + 1);
    assert_eq!(
        window.pull(&query(&project, THREAD, Some(&oversized))),
        invalid
    );
    assert_eq!(window.pull(&query(&project, "no thread", None)), invalid);
    assert_eq!(
        window.pull(&query(&project, THREAD, Some("c1.0.1.o.0.-."))),
        Err(STALE_THREAD_REQUESTS_CURSOR_ERROR.to_string())
    );
}

#[test]
fn pull_is_an_error_while_another_instance_holds_the_projects_journal() {
    let window = Window::open();
    let project = Directory::create("project");
    window.workspaces.register(&project.root).expect("register");
    let other_instance = HistoryRuntimeRequestStore::new(window.history.root.clone());
    let claimed = other_instance.claim_root(&scope_of(&project), "boot-0000", 0);
    assert!(claimed.is_ok_and(|claim| claim.is_owned()));

    let refused = window.pull(&query(&project, THREAD, None));

    let error = refused.expect_err("another instance's rows were served");
    assert!(error.contains("another running instance"), "{error}");
    drop(other_instance);
    assert_eq!(window.pull(&query(&project, THREAD, None)), Ok(Vec::new()));
}
