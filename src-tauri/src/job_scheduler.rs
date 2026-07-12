use crate::file_watcher::{WorkspaceWatchEvent, WorkspaceWatchEventBatch, WorkspaceWatchEventKind};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexJobQueue {
    WatchEvents,
    MetadataScan,
    Parse,
    DbWrite,
    Maintenance,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct IndexFileMetadata {
    pub language: String,
    pub modified_at_unix: i64,
    pub path: String,
    pub relative_path: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct IndexFileSymbols {
    pub file_path: String,
    pub relative_path: String,
    pub symbols: Vec<IndexSymbolRecord>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct IndexSymbolRecord {
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: IndexSymbolKind,
    pub name: String,
    pub range: IndexSymbolRange,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum IndexSymbolKind {
    Class,
    Constant,
    Enum,
    Function,
    Interface,
    Method,
    Property,
    Trait,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct IndexSymbolRange {
    pub end_byte: i64,
    pub end_column: i64,
    pub end_line: i64,
    pub start_byte: i64,
    pub start_column: i64,
    pub start_line: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexDbWriteOperation {
    ReplaceFileSymbols { file_symbols: IndexFileSymbols },
    RemoveFile { path: String },
    UpsertFileMetadata { metadata: IndexFileMetadata },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexMaintenanceTask {
    OptimizeDatabase,
    PruneDeletedFiles,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexJobPayload {
    WatchEvents { batch: WorkspaceWatchEventBatch },
    MetadataScan { path: String },
    ParseFile { path: String, relative_path: String },
    DbWrite { operation: IndexDbWriteOperation },
    Maintenance { task: IndexMaintenanceTask },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexCommitDecision {
    Committed,
    SkippedStale,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct IndexCommitScope {
    pub generation: u64,
    pub workspace_root: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum IndexCommitPermission {
    Cancelled,
    Current,
    Stale,
}

pub trait IndexCommitGate {
    fn check(&self, scope: &IndexCommitScope) -> IndexCommitPermission;
}

impl IndexJobPayload {
    pub fn queue(&self) -> IndexJobQueue {
        match self {
            Self::WatchEvents { .. } => IndexJobQueue::WatchEvents,
            Self::MetadataScan { .. } => IndexJobQueue::MetadataScan,
            Self::ParseFile { .. } => IndexJobQueue::Parse,
            Self::DbWrite { .. } => IndexJobQueue::DbWrite,
            Self::Maintenance { .. } => IndexJobQueue::Maintenance,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledIndexJob {
    pub generation: u64,
    pub id: u64,
    pub payload: IndexJobPayload,
    pub queue: IndexJobQueue,
    pub workspace_root: String,
}

impl ScheduledIndexJob {
    pub fn commit_scope(&self) -> IndexCommitScope {
        IndexCommitScope {
            generation: self.generation,
            workspace_root: self.workspace_root.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduleIndexJobRequest {
    pub payload: IndexJobPayload,
    pub workspace_root: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexJobQueuePolicy {
    queues: Vec<IndexJobQueue>,
}

impl Default for IndexJobQueuePolicy {
    fn default() -> Self {
        Self {
            queues: vec![
                IndexJobQueue::WatchEvents,
                IndexJobQueue::MetadataScan,
                IndexJobQueue::Parse,
                IndexJobQueue::DbWrite,
                IndexJobQueue::Maintenance,
            ],
        }
    }
}

impl IndexJobQueuePolicy {
    pub fn new(queues: Vec<IndexJobQueue>) -> Self {
        Self { queues }
    }

    pub fn queues(&self) -> &[IndexJobQueue] {
        &self.queues
    }
}

pub trait IndexJobScheduler {
    fn dequeue_next(&mut self) -> Option<ScheduledIndexJob>;
    fn enqueue(&mut self, request: ScheduleIndexJobRequest) -> ScheduledIndexJob;
    fn pending_count(&self, queue: IndexJobQueue) -> usize;
}

pub trait IndexWatchEventRouter {
    fn route_watch_events(&mut self, batch: WorkspaceWatchEventBatch) -> Vec<ScheduledIndexJob>;
}

pub trait IndexDbWriteExecutor {
    fn execute(&mut self, operation: &IndexDbWriteOperation) -> Result<(), String>;
}

#[derive(Debug, Clone)]
pub struct WorkspaceIndexLifecycle {
    state: Arc<Mutex<WorkspaceIndexLifecycleState>>,
}

#[derive(Debug, Default)]
struct WorkspaceIndexLifecycleState {
    global_generation: u64,
    workspace_generations: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceIndexLifecycleToken {
    generation: u64,
    global_generation: u64,
    lifecycle: WorkspaceIndexLifecycle,
    workspace_root: String,
}

impl Default for WorkspaceIndexLifecycle {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceIndexLifecycle {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(WorkspaceIndexLifecycleState::default())),
        }
    }

    pub fn begin_workspace_run(&self, workspace_root: &str) -> WorkspaceIndexLifecycleToken {
        let mut state = self.lock_state();
        let generation = bump_workspace_generation(&mut state, workspace_root);

        WorkspaceIndexLifecycleToken {
            generation,
            global_generation: state.global_generation,
            lifecycle: self.clone(),
            workspace_root: workspace_root.to_string(),
        }
    }

    pub fn cancel_workspace(&self, workspace_root: &str) -> u64 {
        let mut state = self.lock_state();
        bump_workspace_generation(&mut state, workspace_root)
    }

    pub fn cancel_workspace_and_block_writes<T>(
        &self,
        workspace_root: &str,
        action: impl FnOnce() -> T,
    ) -> T {
        let mut state = self.lock_state();
        bump_workspace_generation(&mut state, workspace_root);
        let result = action();
        drop(state);
        result
    }

    pub fn cancel_all(&self) -> u64 {
        let mut state = self.lock_state();
        state.global_generation = state.global_generation.saturating_add(1);
        state.global_generation
    }

    pub fn current_generation(&self, workspace_root: &str) -> u64 {
        let state = self.lock_state();
        current_workspace_generation(&state, workspace_root)
    }

    fn lock_state(&self) -> MutexGuard<'_, WorkspaceIndexLifecycleState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn is_token_current(
        state: &WorkspaceIndexLifecycleState,
        token: &WorkspaceIndexLifecycleToken,
    ) -> bool {
        token.global_generation == state.global_generation
            && token.generation == current_workspace_generation(state, &token.workspace_root)
    }
}

impl WorkspaceIndexLifecycleToken {
    pub fn is_current(&self) -> bool {
        let state = self.lifecycle.lock_state();
        WorkspaceIndexLifecycle::is_token_current(&state, self)
    }

    pub fn run_if_current<T>(&self, action: impl FnOnce() -> T) -> Option<T> {
        let state = self.lifecycle.lock_state();

        if !WorkspaceIndexLifecycle::is_token_current(&state, self) {
            return None;
        }

        let result = action();
        drop(state);
        Some(result)
    }

    pub fn workspace_root(&self) -> &str {
        &self.workspace_root
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
}

fn bump_workspace_generation(
    state: &mut WorkspaceIndexLifecycleState,
    workspace_root: &str,
) -> u64 {
    let generation = state
        .workspace_generations
        .entry(workspace_root.to_string())
        .or_insert(0);
    *generation = generation.saturating_add(1);
    *generation
}

fn current_workspace_generation(state: &WorkspaceIndexLifecycleState, workspace_root: &str) -> u64 {
    state
        .workspace_generations
        .get(workspace_root)
        .copied()
        .unwrap_or(0)
}

pub trait IndexGenerationGuard {
    fn cancel_workspace(&mut self, workspace_root: &str) -> u64;
    fn commit_db_write(
        &self,
        job: &ScheduledIndexJob,
        executor: &mut dyn IndexDbWriteExecutor,
    ) -> Result<IndexCommitDecision, String>;
    fn current_generation(&self, workspace_root: &str) -> u64;
    fn is_current(&self, job: &ScheduledIndexJob) -> bool;
}

#[derive(Debug)]
pub struct InMemoryIndexJobScheduler {
    db_write: VecDeque<ScheduledIndexJob>,
    generations: HashMap<String, u64>,
    maintenance: VecDeque<ScheduledIndexJob>,
    metadata_scan: VecDeque<ScheduledIndexJob>,
    next_id: u64,
    parse: VecDeque<ScheduledIndexJob>,
    policy: IndexJobQueuePolicy,
    watch_events: VecDeque<ScheduledIndexJob>,
}

impl Default for InMemoryIndexJobScheduler {
    fn default() -> Self {
        Self::new(IndexJobQueuePolicy::default())
    }
}

impl InMemoryIndexJobScheduler {
    pub fn new(policy: IndexJobQueuePolicy) -> Self {
        Self {
            db_write: VecDeque::new(),
            generations: HashMap::new(),
            maintenance: VecDeque::new(),
            metadata_scan: VecDeque::new(),
            next_id: 1,
            parse: VecDeque::new(),
            policy,
            watch_events: VecDeque::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.db_write.is_empty()
            && self.maintenance.is_empty()
            && self.metadata_scan.is_empty()
            && self.parse.is_empty()
            && self.watch_events.is_empty()
    }

    fn queue_mut(&mut self, queue: IndexJobQueue) -> &mut VecDeque<ScheduledIndexJob> {
        match queue {
            IndexJobQueue::WatchEvents => &mut self.watch_events,
            IndexJobQueue::MetadataScan => &mut self.metadata_scan,
            IndexJobQueue::Parse => &mut self.parse,
            IndexJobQueue::DbWrite => &mut self.db_write,
            IndexJobQueue::Maintenance => &mut self.maintenance,
        }
    }

    fn queue(&self, queue: IndexJobQueue) -> &VecDeque<ScheduledIndexJob> {
        match queue {
            IndexJobQueue::WatchEvents => &self.watch_events,
            IndexJobQueue::MetadataScan => &self.metadata_scan,
            IndexJobQueue::Parse => &self.parse,
            IndexJobQueue::DbWrite => &self.db_write,
            IndexJobQueue::Maintenance => &self.maintenance,
        }
    }

    fn remove_workspace_jobs(&mut self, workspace_root: &str) {
        self.watch_events
            .retain(|job| job.workspace_root != workspace_root);
        self.metadata_scan
            .retain(|job| job.workspace_root != workspace_root);
        self.parse
            .retain(|job| job.workspace_root != workspace_root);
        self.db_write
            .retain(|job| job.workspace_root != workspace_root);
        self.maintenance
            .retain(|job| job.workspace_root != workspace_root);
    }
}

impl IndexJobScheduler for InMemoryIndexJobScheduler {
    fn dequeue_next(&mut self) -> Option<ScheduledIndexJob> {
        let queues = self.policy.queues().to_vec();

        for queue in queues {
            if let Some(job) = self.queue_mut(queue).pop_front() {
                return Some(job);
            }
        }

        None
    }

    fn enqueue(&mut self, request: ScheduleIndexJobRequest) -> ScheduledIndexJob {
        let queue = request.payload.queue();
        let generation = self.current_generation(&request.workspace_root);
        let job = ScheduledIndexJob {
            generation,
            id: self.next_id,
            payload: request.payload,
            queue,
            workspace_root: request.workspace_root,
        };
        self.next_id += 1;
        self.queue_mut(queue).push_back(job.clone());
        job
    }

    fn pending_count(&self, queue: IndexJobQueue) -> usize {
        self.queue(queue).len()
    }
}

impl IndexGenerationGuard for InMemoryIndexJobScheduler {
    fn cancel_workspace(&mut self, workspace_root: &str) -> u64 {
        let generation = self.current_generation(workspace_root) + 1;
        self.generations
            .insert(workspace_root.to_string(), generation);
        self.remove_workspace_jobs(workspace_root);
        generation
    }

    fn commit_db_write(
        &self,
        job: &ScheduledIndexJob,
        executor: &mut dyn IndexDbWriteExecutor,
    ) -> Result<IndexCommitDecision, String> {
        if !self.is_current(job) {
            return Ok(IndexCommitDecision::SkippedStale);
        }

        match &job.payload {
            IndexJobPayload::DbWrite { operation } => {
                executor.execute(operation)?;
                Ok(IndexCommitDecision::Committed)
            }
            _ => Err("Only DB-write jobs can be committed.".to_string()),
        }
    }

    fn current_generation(&self, workspace_root: &str) -> u64 {
        self.generations.get(workspace_root).copied().unwrap_or(1)
    }

    fn is_current(&self, job: &ScheduledIndexJob) -> bool {
        job.generation == self.current_generation(&job.workspace_root)
    }
}

impl IndexCommitGate for InMemoryIndexJobScheduler {
    fn check(&self, scope: &IndexCommitScope) -> IndexCommitPermission {
        if scope.generation == self.current_generation(&scope.workspace_root) {
            return IndexCommitPermission::Current;
        }

        IndexCommitPermission::Stale
    }
}

impl IndexWatchEventRouter for InMemoryIndexJobScheduler {
    fn route_watch_events(&mut self, batch: WorkspaceWatchEventBatch) -> Vec<ScheduledIndexJob> {
        let mut jobs = Vec::new();

        for event in batch.events {
            route_watch_event(self, &event, &mut jobs);
        }

        jobs
    }
}

fn route_watch_event(
    scheduler: &mut InMemoryIndexJobScheduler,
    event: &WorkspaceWatchEvent,
    jobs: &mut Vec<ScheduledIndexJob>,
) {
    if event.kind == WorkspaceWatchEventKind::RescanRequired {
        jobs.push(scheduler.enqueue(ScheduleIndexJobRequest {
            payload: IndexJobPayload::MetadataScan {
                path: event.root_path.clone(),
            },
            workspace_root: event.root_path.clone(),
        }));
        return;
    }

    if event.kind == WorkspaceWatchEventKind::Deleted {
        enqueue_remove_file(scheduler, &event.root_path, &event.path, jobs);
        return;
    }

    if event.kind == WorkspaceWatchEventKind::Renamed {
        if let Some(previous_path) = &event.previous_path {
            enqueue_remove_file(scheduler, &event.root_path, previous_path, jobs);
        }

        enqueue_metadata_scan(scheduler, event, jobs);
        return;
    }

    enqueue_metadata_scan(scheduler, event, jobs);
}

fn enqueue_remove_file(
    scheduler: &mut InMemoryIndexJobScheduler,
    workspace_root: &str,
    path: &str,
    jobs: &mut Vec<ScheduledIndexJob>,
) {
    jobs.push(scheduler.enqueue(ScheduleIndexJobRequest {
        payload: IndexJobPayload::DbWrite {
            operation: IndexDbWriteOperation::RemoveFile {
                path: path.to_string(),
            },
        },
        workspace_root: workspace_root.to_string(),
    }));
}

fn enqueue_metadata_scan(
    scheduler: &mut InMemoryIndexJobScheduler,
    event: &WorkspaceWatchEvent,
    jobs: &mut Vec<ScheduledIndexJob>,
) {
    jobs.push(scheduler.enqueue(ScheduleIndexJobRequest {
        payload: IndexJobPayload::MetadataScan {
            path: event.path.clone(),
        },
        workspace_root: event.root_path.clone(),
    }));
}

#[cfg(test)]
mod tests {
    use super::{
        InMemoryIndexJobScheduler, IndexCommitDecision, IndexDbWriteExecutor,
        IndexDbWriteOperation, IndexGenerationGuard, IndexJobPayload, IndexJobQueue,
        IndexJobQueuePolicy, IndexJobScheduler, IndexMaintenanceTask, IndexWatchEventRouter,
        ScheduleIndexJobRequest, WorkspaceIndexLifecycle,
    };
    use crate::file_watcher::{
        WorkspaceWatchBackend, WorkspaceWatchEvent, WorkspaceWatchEventBatch,
        WorkspaceWatchEventKind, WorkspaceWatchFileKind,
    };

    #[test]
    fn enqueues_jobs_into_payload_queues() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        scheduler.enqueue(request(IndexJobPayload::MetadataScan {
            path: "/workspace".to_string(),
        }));
        scheduler.enqueue(request(IndexJobPayload::ParseFile {
            path: "/workspace/src/User.php".to_string(),
            relative_path: "src/User.php".to_string(),
        }));
        scheduler.enqueue(request(IndexJobPayload::DbWrite {
            operation: IndexDbWriteOperation::UpsertFileMetadata {
                metadata: file_metadata("/workspace/src/User.php", 128),
            },
        }));

        assert_eq!(scheduler.pending_count(IndexJobQueue::MetadataScan), 1);
        assert_eq!(scheduler.pending_count(IndexJobQueue::Parse), 1);
        assert_eq!(scheduler.pending_count(IndexJobQueue::DbWrite), 1);
    }

    #[test]
    fn jobs_capture_current_workspace_generation_when_enqueued() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let first = scheduler.enqueue(request(IndexJobPayload::ParseFile {
            path: "/workspace/src/A.php".to_string(),
            relative_path: "src/A.php".to_string(),
        }));
        scheduler.cancel_workspace("/workspace");
        let second = scheduler.enqueue(request(IndexJobPayload::ParseFile {
            path: "/workspace/src/B.php".to_string(),
            relative_path: "src/B.php".to_string(),
        }));

        assert_eq!(first.generation, 1);
        assert_eq!(second.generation, 2);
    }

    #[test]
    fn cancelling_workspace_removes_pending_jobs_for_that_workspace() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        scheduler.enqueue(request(IndexJobPayload::ParseFile {
            path: "/workspace/src/A.php".to_string(),
            relative_path: "src/A.php".to_string(),
        }));
        scheduler.enqueue(ScheduleIndexJobRequest {
            payload: IndexJobPayload::ParseFile {
                path: "/other/src/B.php".to_string(),
                relative_path: "src/B.php".to_string(),
            },
            workspace_root: "/other".to_string(),
        });

        let generation = scheduler.cancel_workspace("/workspace");

        assert_eq!(generation, 2);
        assert_eq!(scheduler.pending_count(IndexJobQueue::Parse), 1);
        assert_eq!(
            scheduler
                .dequeue_next()
                .expect("remaining job")
                .workspace_root,
            "/other"
        );
    }

    #[test]
    fn stale_db_write_jobs_do_not_commit() {
        let mut scheduler = InMemoryIndexJobScheduler::default();
        let job = scheduler.enqueue(request(IndexJobPayload::DbWrite {
            operation: IndexDbWriteOperation::RemoveFile {
                path: "/workspace/src/User.php".to_string(),
            },
        }));
        let mut executor = RecordingDbWriteExecutor::default();

        scheduler.cancel_workspace("/workspace");
        let decision = scheduler
            .commit_db_write(&job, &mut executor)
            .expect("commit decision");

        assert_eq!(decision, IndexCommitDecision::SkippedStale);
        assert!(executor.operations.is_empty());
    }

    #[test]
    fn current_db_write_jobs_commit() {
        let mut scheduler = InMemoryIndexJobScheduler::default();
        let job = scheduler.enqueue(request(IndexJobPayload::DbWrite {
            operation: IndexDbWriteOperation::RemoveFile {
                path: "/workspace/src/User.php".to_string(),
            },
        }));
        let mut executor = RecordingDbWriteExecutor::default();

        let decision = scheduler
            .commit_db_write(&job, &mut executor)
            .expect("commit decision");

        assert_eq!(decision, IndexCommitDecision::Committed);
        assert_eq!(executor.operations.len(), 1);
    }

    #[test]
    fn lifecycle_begin_workspace_run_invalidates_previous_run_for_root() {
        let lifecycle = WorkspaceIndexLifecycle::new();
        let first = lifecycle.begin_workspace_run("/workspace");
        let second = lifecycle.begin_workspace_run("/workspace");

        assert!(!first.is_current());
        assert!(second.is_current());
        assert_eq!(second.generation(), 2);
    }

    #[test]
    fn lifecycle_cancel_all_invalidates_active_runs() {
        let lifecycle = WorkspaceIndexLifecycle::new();
        let workspace = lifecycle.begin_workspace_run("/workspace");
        let other = lifecycle.begin_workspace_run("/other");

        lifecycle.cancel_all();

        assert!(!workspace.is_current());
        assert!(!other.is_current());
    }

    #[test]
    fn lifecycle_cancel_workspace_preserves_other_workspace_runs() {
        let lifecycle = WorkspaceIndexLifecycle::new();
        let workspace = lifecycle.begin_workspace_run("/workspace");
        let other = lifecycle.begin_workspace_run("/other");

        lifecycle.cancel_workspace("/workspace");

        assert!(!workspace.is_current());
        assert!(other.is_current());
    }

    #[test]
    fn lifecycle_guarded_write_runs_only_for_current_token() {
        let lifecycle = WorkspaceIndexLifecycle::new();
        let token = lifecycle.begin_workspace_run("/workspace");

        assert_eq!(token.run_if_current(|| 42), Some(42));
        lifecycle.cancel_workspace("/workspace");

        assert_eq!(token.run_if_current(|| 13), None);
    }

    #[test]
    fn dequeues_by_default_queue_priority() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        scheduler.enqueue(request(IndexJobPayload::Maintenance {
            task: IndexMaintenanceTask::OptimizeDatabase,
        }));
        scheduler.enqueue(request(IndexJobPayload::DbWrite {
            operation: IndexDbWriteOperation::RemoveFile {
                path: "/workspace/src/User.php".to_string(),
            },
        }));
        scheduler.enqueue(request(IndexJobPayload::WatchEvents {
            batch: watch_batch(),
        }));

        assert_eq!(
            scheduler.dequeue_next().expect("watch job").queue,
            IndexJobQueue::WatchEvents
        );
        assert_eq!(
            scheduler.dequeue_next().expect("write job").queue,
            IndexJobQueue::DbWrite
        );
        assert_eq!(
            scheduler.dequeue_next().expect("maintenance job").queue,
            IndexJobQueue::Maintenance
        );
        assert!(scheduler.is_empty());
    }

    #[test]
    fn preserves_fifo_order_within_each_queue() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let first = scheduler.enqueue(request(IndexJobPayload::ParseFile {
            path: "/workspace/src/A.php".to_string(),
            relative_path: "src/A.php".to_string(),
        }));
        let second = scheduler.enqueue(request(IndexJobPayload::ParseFile {
            path: "/workspace/src/B.php".to_string(),
            relative_path: "src/B.php".to_string(),
        }));

        assert_eq!(scheduler.dequeue_next().expect("first parse").id, first.id);
        assert_eq!(
            scheduler.dequeue_next().expect("second parse").id,
            second.id
        );
    }

    #[test]
    fn custom_queue_policy_changes_dequeue_order() {
        let policy = IndexJobQueuePolicy::new(vec![
            IndexJobQueue::DbWrite,
            IndexJobQueue::WatchEvents,
            IndexJobQueue::Maintenance,
            IndexJobQueue::MetadataScan,
            IndexJobQueue::Parse,
        ]);
        let mut scheduler = InMemoryIndexJobScheduler::new(policy);

        scheduler.enqueue(request(IndexJobPayload::WatchEvents {
            batch: watch_batch(),
        }));
        scheduler.enqueue(request(IndexJobPayload::DbWrite {
            operation: IndexDbWriteOperation::RemoveFile {
                path: "/workspace/src/User.php".to_string(),
            },
        }));

        assert_eq!(
            scheduler.dequeue_next().expect("write job").queue,
            IndexJobQueue::DbWrite
        );
    }

    #[test]
    fn watch_event_batches_are_scheduled_as_watch_jobs() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let job = scheduler.enqueue(request(IndexJobPayload::WatchEvents {
            batch: watch_batch(),
        }));

        assert_eq!(job.queue, IndexJobQueue::WatchEvents);
        match job.payload {
            IndexJobPayload::WatchEvents { batch } => {
                assert_eq!(batch.events.len(), 1);
                assert_eq!(batch.events[0].relative_path, "src/User.php");
            }
            _ => panic!("expected watch event payload"),
        }
    }

    #[test]
    fn routes_watch_create_and_modify_events_to_metadata_scan_jobs() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let jobs = scheduler.route_watch_events(WorkspaceWatchEventBatch {
            events: vec![
                watch_event(WorkspaceWatchEventKind::Created, "src/New.php"),
                watch_event(WorkspaceWatchEventKind::Modified, "src/Changed.php"),
            ],
        });

        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].queue, IndexJobQueue::MetadataScan);
        assert_eq!(jobs[1].queue, IndexJobQueue::MetadataScan);
    }

    #[test]
    fn routes_watch_delete_events_to_db_write_remove_jobs() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let jobs = scheduler.route_watch_events(WorkspaceWatchEventBatch {
            events: vec![watch_event(
                WorkspaceWatchEventKind::Deleted,
                "src/Deleted.php",
            )],
        });

        assert_eq!(jobs.len(), 1);
        match &jobs[0].payload {
            IndexJobPayload::DbWrite {
                operation: IndexDbWriteOperation::RemoveFile { path },
            } => assert_eq!(path, "/workspace/src/Deleted.php"),
            _ => panic!("expected remove write job"),
        }
    }

    #[test]
    fn routes_watch_rename_events_to_delete_then_metadata_scan() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let jobs = scheduler.route_watch_events(WorkspaceWatchEventBatch {
            events: vec![rename_event("src/Old.php", "src/New.php")],
        });

        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].queue, IndexJobQueue::DbWrite);
        assert_eq!(jobs[1].queue, IndexJobQueue::MetadataScan);
    }

    #[test]
    fn routes_rescan_events_to_workspace_metadata_scan() {
        let mut scheduler = InMemoryIndexJobScheduler::default();

        let jobs = scheduler.route_watch_events(WorkspaceWatchEventBatch {
            events: vec![WorkspaceWatchEvent {
                backend: WorkspaceWatchBackend::Native,
                file_kind: Some(WorkspaceWatchFileKind::Directory),
                kind: WorkspaceWatchEventKind::RescanRequired,
                path: "/workspace".to_string(),
                previous_path: None,
                previous_relative_path: None,
                relative_path: String::new(),
                root_path: "/workspace".to_string(),
            }],
        });

        assert_eq!(jobs.len(), 1);
        match &jobs[0].payload {
            IndexJobPayload::MetadataScan { path } => assert_eq!(path, "/workspace"),
            _ => panic!("expected metadata scan"),
        }
    }

    fn request(payload: IndexJobPayload) -> ScheduleIndexJobRequest {
        ScheduleIndexJobRequest {
            payload,
            workspace_root: "/workspace".to_string(),
        }
    }

    fn watch_batch() -> WorkspaceWatchEventBatch {
        WorkspaceWatchEventBatch {
            events: vec![watch_event(
                WorkspaceWatchEventKind::Modified,
                "src/User.php",
            )],
        }
    }

    fn watch_event(kind: WorkspaceWatchEventKind, relative_path: &str) -> WorkspaceWatchEvent {
        WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(WorkspaceWatchFileKind::File),
            kind,
            path: format!("/workspace/{relative_path}"),
            previous_path: None,
            previous_relative_path: None,
            relative_path: relative_path.to_string(),
            root_path: "/workspace".to_string(),
        }
    }

    fn rename_event(previous_relative_path: &str, relative_path: &str) -> WorkspaceWatchEvent {
        WorkspaceWatchEvent {
            backend: WorkspaceWatchBackend::Native,
            file_kind: Some(WorkspaceWatchFileKind::File),
            kind: WorkspaceWatchEventKind::Renamed,
            path: format!("/workspace/{relative_path}"),
            previous_path: Some(format!("/workspace/{previous_relative_path}")),
            previous_relative_path: Some(previous_relative_path.to_string()),
            relative_path: relative_path.to_string(),
            root_path: "/workspace".to_string(),
        }
    }

    fn file_metadata(path: &str, size_bytes: i64) -> super::IndexFileMetadata {
        super::IndexFileMetadata {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: path.to_string(),
            relative_path: path.strip_prefix("/workspace/").unwrap_or(path).to_string(),
            size_bytes,
        }
    }

    #[derive(Default)]
    struct RecordingDbWriteExecutor {
        operations: Vec<IndexDbWriteOperation>,
    }

    impl IndexDbWriteExecutor for RecordingDbWriteExecutor {
        fn execute(&mut self, operation: &IndexDbWriteOperation) -> Result<(), String> {
            self.operations.push(operation.clone());
            Ok(())
        }
    }
}
