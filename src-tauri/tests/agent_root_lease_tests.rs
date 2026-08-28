#![cfg(unix)]
#![allow(dead_code)]

mod workspace_registry {
    #[derive(Clone, Debug, Eq, Hash, PartialEq)]
    pub struct WorkspaceId(pub String);
}

#[path = "../src/agent_root_lease.rs"]
mod agent_root_lease;

#[path = "../src/agent_task_spawner.rs"]
mod agent_task_spawner;

#[path = "../src/agent_task_admission.rs"]
mod agent_task_admission;

#[path = "../src/agent_task_supervisor.rs"]
mod agent_task_supervisor;

use agent_root_lease::{
    dispose_should_stop_agent_tasks, AgentRootLeaseRegistry, AgentRootLeaseReleaseDisposition,
    AGENT_ROOT_LEASE_LIMIT_ERROR, MAX_AGENT_ROOT_LEASES,
};
use agent_task_admission::AgentTaskAdmissionRegistry;
use agent_task_spawner::{AgentChild, AgentProcessSpawner, AgentTaskSpawnPlan};
use agent_task_supervisor::{
    AgentProcessGroupSignalSender, AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent,
    AgentTaskRegistry, AgentTaskStartRequest, AgentTaskStatusEvent, AgentTaskStatusPayload,
    KILL_PROCESS_GROUP_SIGNAL, TERMINATE_PROCESS_GROUP_SIGNAL,
};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use workspace_registry::WorkspaceId;

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

const EVENT_DEADLINE: Duration = Duration::from_secs(5);
const QUIET_WINDOW: Duration = Duration::from_millis(400);

fn unique_directory(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "agent-root-lease-{label}-{}-{}",
        std::process::id(),
        NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::create_dir_all(&path);

    path.canonicalize().unwrap_or(path)
}

fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if predicate() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(5));
    }
}

fn stayed_false(window: Duration, predicate: impl FnMut() -> bool) -> bool {
    !wait_until(window, predicate)
}

fn is_terminal_status(status: &AgentTaskStatusPayload) -> bool {
    matches!(
        status,
        AgentTaskStatusPayload::Exited { .. }
            | AgentTaskStatusPayload::Failed { .. }
            | AgentTaskStatusPayload::Stopped
    )
}

#[derive(Default)]
struct RecordingSink {
    statuses: Mutex<Vec<AgentTaskStatusEvent>>,
}

impl RecordingSink {
    fn has_terminal_status(&self, task_id: &str) -> bool {
        self.statuses
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .any(|event| event.task_id == task_id && is_terminal_status(&event.status))
    }
}

impl AgentTaskEventSink for RecordingSink {
    fn status(&self, event: AgentTaskStatusEvent) {
        self.statuses
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
    }

    fn output(&self, _event: AgentTaskOutputEvent) {}
}

struct FakeProcess {
    exit: Mutex<Option<i32>>,
    exit_signal: Condvar,
    term_exit_code: Option<i32>,
}

impl FakeProcess {
    fn new(term_exit_code: Option<i32>) -> Arc<Self> {
        Arc::new(Self {
            exit: Mutex::new(None),
            exit_signal: Condvar::new(),
            term_exit_code,
        })
    }

    fn set_exited(&self, code: i32) {
        let mut exit = self
            .exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if exit.is_none() {
            *exit = Some(code);
        }
        self.exit_signal.notify_all();
    }

    fn exit_code(&self) -> Option<i32> {
        *self
            .exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn wait_exited_blocking(&self) {
        let exit = self
            .exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _exit = self.exit_signal.wait_while(exit, |code| code.is_none());
    }
}

struct BlockingReader {
    process: Arc<FakeProcess>,
}

impl Read for BlockingReader {
    fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
        self.process.wait_exited_blocking();

        Ok(0)
    }
}

struct FakeChild {
    process: Arc<FakeProcess>,
    process_group_id: i32,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
}

impl FakeChild {
    fn new(process: &Arc<FakeProcess>, process_group_id: i32) -> Self {
        Self {
            process: Arc::clone(process),
            process_group_id,
            stdout: Some(Box::new(BlockingReader {
                process: Arc::clone(process),
            })),
            stderr: Some(Box::new(BlockingReader {
                process: Arc::clone(process),
            })),
        }
    }
}

impl AgentChild for FakeChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.stdout
            .take()
            .ok_or_else(|| "stdout already taken".to_string())
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.stderr
            .take()
            .ok_or_else(|| "stderr already taken".to_string())
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        Ok(self.process.exit_code())
    }

    fn process_group_id(&self) -> i32 {
        self.process_group_id
    }

    fn force_kill(&mut self) -> Result<(), String> {
        self.process.set_exited(137);
        Ok(())
    }
}

#[derive(Default)]
struct FakeSpawner {
    children: Mutex<Vec<FakeChild>>,
}

impl FakeSpawner {
    fn script(&self, child: FakeChild) {
        self.children
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(child);
    }
}

impl AgentProcessSpawner for FakeSpawner {
    fn spawn(&self, _plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let child = self
            .children
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pop();
        let Some(child) = child else {
            return Err("no scripted spawn outcome".to_string());
        };

        Ok(Box::new(child))
    }
}

#[derive(Default)]
struct RecordingSignalSender {
    signals: Mutex<Vec<(i32, i32)>>,
    processes: Mutex<HashMap<i32, Arc<FakeProcess>>>,
}

impl RecordingSignalSender {
    fn track(&self, process_group_id: i32, process: &Arc<FakeProcess>) {
        self.processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(process_group_id, Arc::clone(process));
    }

    fn signals_for(&self, process_group_id: i32) -> Vec<i32> {
        self.signals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(target, _)| *target == process_group_id)
            .map(|(_, signal)| *signal)
            .collect()
    }
}

impl AgentProcessGroupSignalSender for RecordingSignalSender {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.signals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((process_group_id, signal));
        let process = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&process_group_id)
            .cloned();
        let Some(process) = process else {
            return Ok(());
        };
        if signal == KILL_PROCESS_GROUP_SIGNAL {
            process.set_exited(137);

            return Ok(());
        }
        if signal == TERMINATE_PROCESS_GROUP_SIGNAL {
            if let Some(code) = process.term_exit_code {
                process.set_exited(code);
            }
        }

        Ok(())
    }
}

struct Fixture {
    registry: AgentTaskRegistry,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
    signals: Arc<RecordingSignalSender>,
    spawner: Arc<FakeSpawner>,
    leases: Arc<AgentRootLeaseRegistry>,
}

fn fixture() -> Fixture {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let signals = Arc::new(RecordingSignalSender::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::clone(&signals) as Arc<dyn AgentProcessGroupSignalSender>,
        Duration::from_secs(60),
        Duration::from_millis(100),
        Duration::from_millis(200),
    );

    Fixture {
        registry,
        admission,
        sink,
        signals,
        spawner,
        leases: Arc::new(AgentRootLeaseRegistry::new()),
    }
}

fn fake_plan(cwd: &Path) -> AgentTaskSpawnPlan {
    AgentTaskSpawnPlan::for_tests(
        PathBuf::from("/bin/fake-agent"),
        vec!["-p".to_string(), "prompt".to_string()],
        cwd.to_path_buf(),
        Vec::new(),
    )
}

fn dispatch(
    fixture: &Fixture,
    task_id: &str,
    repository_root: &Path,
    cwd: &Path,
) -> Result<(), String> {
    let admission = fixture.admission.reserve(
        &WorkspaceId("ws-agent-root-lease".to_string()),
        repository_root,
        cwd,
        AgentTaskIsolation::Worktree,
    )?;
    fixture.registry.start(
        AgentTaskStartRequest {
            task_id: task_id.to_string(),
            workspace_id: "ws-agent-root-lease".to_string(),
            repository_root: repository_root.to_path_buf(),
            isolation: AgentTaskIsolation::Worktree,
            worktree_path: Some(cwd.to_path_buf()),
        },
        fake_plan(cwd),
        admission,
    )?;
    fixture.registry.acknowledge(task_id)
}

struct LiveTask {
    root: PathBuf,
    worktree: PathBuf,
    process: Arc<FakeProcess>,
    process_group_id: i32,
}

fn start_live_task(fixture: &Fixture, label: &str, task_id: &str) -> Result<LiveTask, String> {
    let root = unique_directory(label);
    let worktree = root.join(".worktrees").join(task_id);
    let process = FakeProcess::new(Some(143));
    let process_group_id = 9500 + i32::try_from(NEXT_FIXTURE.load(Ordering::SeqCst)).unwrap_or(0);
    fixture.signals.track(process_group_id, &process);
    fixture
        .spawner
        .script(FakeChild::new(&process, process_group_id));
    dispatch(fixture, task_id, &root, &worktree)?;

    Ok(LiveTask {
        root,
        worktree,
        process,
        process_group_id,
    })
}

fn dispose_workspace_root(fixture: &Fixture, root: &Path) {
    if !dispose_should_stop_agent_tasks(Some(fixture.leases.as_ref()), root) {
        return;
    }

    fixture.registry.stop_for_root(root);
}

fn remove_worktree(fixture: &Fixture, worktree_path: &Path) -> bool {
    fixture.registry.stop_for_root_and_reap(worktree_path)
}

#[test]
fn dispose_with_a_held_lease_leaves_the_live_task_running() {
    let fixture = fixture();
    let task = start_live_task(&fixture, "held", "agt-held-0001").expect("start live task");
    let token = fixture.leases.acquire(&task.root).expect("acquire lease");

    dispose_workspace_root(&fixture, &task.root);

    assert!(
        stayed_false(QUIET_WINDOW, || fixture
            .sink
            .has_terminal_status("agt-held-0001")),
        "leased root must not be stopped by dispose"
    );
    assert!(
        fixture
            .signals
            .signals_for(task.process_group_id)
            .is_empty(),
        "leased root must not be signalled by dispose"
    );
    assert_eq!(task.process.exit_code(), None);

    assert_eq!(
        fixture.leases.release(&task.root, token),
        AgentRootLeaseReleaseDisposition::Released
    );
    fixture
        .registry
        .stop("agt-held-0001")
        .expect("cleanup stop");
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-held-0001")));
}

#[test]
fn dispose_after_release_stops_the_live_task() {
    let fixture = fixture();
    let task = start_live_task(&fixture, "released", "agt-released-0001").expect("start live task");
    let token = fixture.leases.acquire(&task.root).expect("acquire lease");

    dispose_workspace_root(&fixture, &task.root);

    assert!(stayed_false(QUIET_WINDOW, || fixture
        .sink
        .has_terminal_status("agt-released-0001")));
    assert_eq!(
        fixture.leases.release(&task.root, token),
        AgentRootLeaseReleaseDisposition::Released
    );

    dispose_workspace_root(&fixture, &task.root);

    assert!(
        wait_until(EVENT_DEADLINE, || fixture
            .sink
            .has_terminal_status("agt-released-0001")),
        "dispose after release must stop the task"
    );
    assert_eq!(task.process.exit_code(), Some(143));
}

#[test]
fn dispose_of_an_unleased_root_still_stops_its_task() {
    let fixture = fixture();
    let leased = start_live_task(&fixture, "other-leased", "agt-other-0001").expect("start leased");
    let unleased =
        start_live_task(&fixture, "unleased", "agt-unleased-0001").expect("start unleased");
    fixture.leases.acquire(&leased.root).expect("acquire lease");

    dispose_workspace_root(&fixture, &unleased.root);

    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-unleased-0001")));
    assert!(!fixture.sink.has_terminal_status("agt-other-0001"));

    fixture.registry.stop("agt-other-0001").expect("cleanup");
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-other-0001")));
}

#[test]
fn worktree_removal_still_stops_its_task_under_a_held_lease() {
    let fixture = fixture();
    let task = start_live_task(&fixture, "worktree", "agt-worktree-0001").expect("start live task");
    fixture.leases.acquire(&task.root).expect("acquire lease");

    assert!(
        remove_worktree(&fixture, &task.worktree),
        "worktree removal must reap its own agent task"
    );
    assert!(wait_until(EVENT_DEADLINE, || fixture
        .sink
        .has_terminal_status("agt-worktree-0001")));
    assert!(fixture.leases.is_held(&task.root));
}

#[test]
fn lease_lookup_converges_on_path_aliases() {
    let fixture = fixture();
    let real = unique_directory("alias-real");
    let alias_parent = unique_directory("alias-link");
    let alias = alias_parent.join("root");
    std::os::unix::fs::symlink(&real, &alias).expect("create alias symlink");
    let acquired = alias.canonicalize().expect("canonical alias");

    let token = fixture
        .leases
        .acquire(&acquired)
        .expect("acquire via alias");

    assert_eq!(acquired, real);
    assert!(fixture.leases.is_held(&real));
    assert!(!dispose_should_stop_agent_tasks(
        Some(fixture.leases.as_ref()),
        &real
    ));
    assert_eq!(
        fixture.leases.release(&real, token),
        AgentRootLeaseReleaseDisposition::Released
    );
    assert!(dispose_should_stop_agent_tasks(
        Some(fixture.leases.as_ref()),
        &real
    ));
}

#[test]
fn release_dispositions_distinguish_absent_and_foreign_ownership() {
    let fixture = fixture();
    let root = unique_directory("release-dispositions");
    let held_token = fixture.leases.acquire(&root).expect("acquire lease");
    let foreign_token = held_token.wrapping_add(1).max(1);

    assert_eq!(
        fixture.leases.release(&root, foreign_token),
        AgentRootLeaseReleaseDisposition::ForeignOwner
    );
    assert!(fixture.leases.is_held(&root));
    assert_eq!(
        fixture.leases.release(&root, held_token),
        AgentRootLeaseReleaseDisposition::Released
    );
    assert_eq!(
        fixture.leases.release(&root, held_token),
        AgentRootLeaseReleaseDisposition::NotHeld
    );
}

#[test]
fn private_var_and_var_aliases_share_one_lease() {
    let aliased = Path::new("/var/tmp");
    let Ok(canonical) = aliased.canonicalize() else {
        return;
    };
    let fixture = fixture();

    let first = fixture.leases.acquire(&canonical).expect("acquire");
    let second = fixture
        .leases
        .acquire(&aliased.canonicalize().expect("canonical alias"))
        .expect("re-acquire");

    assert_eq!(first, second);
    assert_eq!(fixture.leases.held_root_count(), 1);
}

#[test]
fn lease_registry_caps_project_roots() {
    let fixture = fixture();
    let mut roots = Vec::new();

    for index in 0..MAX_AGENT_ROOT_LEASES {
        let root = PathBuf::from(format!("/agent-root-lease/cap-{index}"));
        let token = fixture
            .leases
            .acquire(&root)
            .expect("acquire within the cap");
        roots.push((root, token));
    }

    let error = fixture
        .leases
        .acquire(Path::new("/agent-root-lease/overflow"))
        .expect_err("cap must be enforced");

    assert_eq!(error, AGENT_ROOT_LEASE_LIMIT_ERROR);

    let (root, token) = roots.remove(0);

    assert_eq!(
        fixture.leases.release(&root, token),
        AgentRootLeaseReleaseDisposition::Released
    );
    fixture
        .leases
        .acquire(Path::new("/agent-root-lease/overflow"))
        .expect("released slot is reusable");
}
