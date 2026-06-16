use crate::file_watcher::{WorkspaceWatchEvent, WorkspaceWatchEventBatch, WorkspaceWatchEventKind};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexJobQueue {
    WatchEvents,
    MetadataScan,
    Parse,
    DbWrite,
    Maintenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexDbWriteOperation {
    RemoveFile { path: String },
    UpsertFileMetadata { path: String },
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
    pub id: u64,
    pub payload: IndexJobPayload,
    pub queue: IndexJobQueue,
    pub workspace_root: String,
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

#[derive(Debug)]
pub struct InMemoryIndexJobScheduler {
    db_write: VecDeque<ScheduledIndexJob>,
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
        let job = ScheduledIndexJob {
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
        InMemoryIndexJobScheduler, IndexDbWriteOperation, IndexJobPayload, IndexJobQueue,
        IndexJobQueuePolicy, IndexJobScheduler, IndexMaintenanceTask, IndexWatchEventRouter,
        ScheduleIndexJobRequest,
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
                path: "/workspace/src/User.php".to_string(),
            },
        }));

        assert_eq!(scheduler.pending_count(IndexJobQueue::MetadataScan), 1);
        assert_eq!(scheduler.pending_count(IndexJobQueue::Parse), 1);
        assert_eq!(scheduler.pending_count(IndexJobQueue::DbWrite), 1);
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
}
