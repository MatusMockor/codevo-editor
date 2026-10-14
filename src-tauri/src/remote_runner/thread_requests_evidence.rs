use super::interactions::{InteractionSource, RemoteInteractions};
use crate::agent_questions::{approvals::AgentApprovalStatus, AgentQuestionStatus};
use crate::agent_runtime_requests::model::{RequestKind, RequestStatus, RuntimeRequest};
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

pub(super) const MAX_TRACKED_TASKS: usize = 256;
pub(super) const MAX_FENCED_PER_TASK: usize = 64;
pub(super) const MAX_SWITCH_DEFERRAL: Duration = Duration::from_secs(300);

type RequestKey = (RequestKind, String);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Marks {
    snapshot: Option<u64>,
    legacy: Option<u64>,
}

impl Marks {
    fn of(&mut self, source: InteractionSource) -> &mut Option<u64> {
        match source {
            InteractionSource::Snapshot => &mut self.snapshot,
            InteractionSource::Legacy => &mut self.legacy,
        }
    }

    fn is_newer_than(mut self, read: &RemoteInteractions) -> bool {
        self.of(read.source)
            .is_some_and(|sequence| sequence > read.sequence)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Verdict {
    Stale,
    Current,
    Vanished,
}

#[derive(Default)]
struct Evidence {
    marks: Marks,
    open: HashSet<RequestKey>,
    settled: Vec<RequestKey>,
    invalidated: bool,
    unreadable_since: Option<Instant>,
    touched: u64,
}

impl Evidence {
    fn has_open_approval(&self) -> bool {
        self.open
            .iter()
            .any(|(kind, _)| *kind == RequestKind::Approval)
    }

    fn fence(&mut self, key: RequestKey) {
        if self.settled.contains(&key) {
            return;
        }
        if self.settled.len() >= MAX_FENCED_PER_TASK {
            self.settled.remove(0);
        }
        self.settled.push(key);
    }
}

struct Tasks {
    max_tasks: usize,
    clock: u64,
    tasks: HashMap<String, Evidence>,
    open_lost: bool,
    invalidation_lost: bool,
    bump_due: bool,
}

impl Tasks {
    fn entry(&mut self, task: &str) -> &mut Evidence {
        self.clock += 1;
        let touched = self.clock;
        if !self.tasks.contains_key(task) {
            self.evict_for_one_more();
        }
        let evidence = self.tasks.entry(task.to_string()).or_default();
        evidence.touched = touched;
        evidence
    }

    fn evict_for_one_more(&mut self) {
        while self.tasks.len() >= self.max_tasks {
            let oldest = self
                .tasks
                .iter()
                .min_by_key(|(_, evidence)| evidence.touched)
                .map(|(task, _)| task.clone());
            let Some(oldest) = oldest else {
                return;
            };
            let evicted = self.tasks.remove(&oldest).unwrap_or_default();
            let lost_open = !evicted.open.is_empty();
            self.open_lost |= lost_open;
            self.invalidation_lost |= evicted.invalidated || lost_open;
            self.bump_due |= lost_open;
        }
    }
}

fn listed(read: &RemoteInteractions) -> (HashSet<RequestKey>, HashSet<RequestKey>) {
    let questions = read.questions.iter().map(|question| {
        (
            (RequestKind::Question, question.id.clone()),
            question.status == AgentQuestionStatus::Pending,
        )
    });
    let approvals = read.approvals.iter().map(|approval| {
        (
            (RequestKind::Approval, approval.id.clone()),
            approval.status == AgentApprovalStatus::Pending,
        )
    });
    let rows: Vec<(RequestKey, bool)> = questions.chain(approvals).collect();
    let present = rows.iter().map(|(key, _)| key.clone()).collect();
    let open = rows
        .into_iter()
        .filter(|(_, open)| *open)
        .map(|(key, _)| key)
        .collect();
    (present, open)
}

fn is_listed_section(read: &RemoteInteractions, key: &RequestKey) -> bool {
    key.0 == RequestKind::Question || read.approvals_complete
}

pub(in crate::remote_runner) struct TaskEvidence(Mutex<Tasks>);

impl Default for TaskEvidence {
    fn default() -> Self {
        Self::with_limit(MAX_TRACKED_TASKS)
    }
}

impl TaskEvidence {
    pub(super) fn with_limit(max_tasks: usize) -> Self {
        Self(Mutex::new(Tasks {
            max_tasks: max_tasks.max(1),
            clock: 0,
            tasks: HashMap::new(),
            open_lost: false,
            invalidation_lost: false,
            bump_due: false,
        }))
    }

    fn locked(&self) -> MutexGuard<'_, Tasks> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn observe(&self, read: &RemoteInteractions) -> Verdict {
        let (present, open_now) = listed(read);
        let mut tasks = self.locked();
        let evidence = tasks.entry(&read.task_id);
        if evidence.marks.is_newer_than(read) {
            return Verdict::Stale;
        }
        let vanished = evidence
            .open
            .iter()
            .any(|key| !present.contains(key) && is_listed_section(read, key));
        let kept: HashSet<RequestKey> = evidence
            .open
            .iter()
            .filter(|key| !is_listed_section(read, key))
            .cloned()
            .collect();
        let settled = &evidence.settled;
        evidence.open = open_now
            .into_iter()
            .filter(|key| !settled.contains(key))
            .chain(kept)
            .collect();
        *evidence.marks.of(read.source) = Some(read.sequence);
        evidence.invalidated |= vanished;
        if read.approvals_complete {
            evidence.unreadable_since = None;
        }
        if vanished {
            return Verdict::Vanished;
        }
        Verdict::Current
    }

    pub(super) fn is_stale(&self, read: &RemoteInteractions) -> bool {
        self.locked()
            .tasks
            .get(&read.task_id)
            .is_some_and(|evidence| evidence.marks.is_newer_than(read))
    }

    pub(super) fn fenced(&self, task: &str, requests: Vec<RuntimeRequest>) -> Vec<RuntimeRequest> {
        let tasks = self.locked();
        let Some(evidence) = tasks.tasks.get(task) else {
            return requests;
        };
        requests
            .into_iter()
            .filter(|request| {
                let parts = request.parts();
                let open = matches!(
                    request.status(),
                    RequestStatus::Pending | RequestStatus::Submitting
                );
                !open
                    || !evidence
                        .settled
                        .contains(&(parts.body.kind(), parts.id.clone()))
            })
            .collect()
    }

    pub(super) fn defers_switch(&self, read: &RemoteInteractions, now: Instant) -> bool {
        let mut tasks = self.locked();
        if let Some(evidence) = tasks.tasks.get_mut(&read.task_id) {
            if read.approvals_complete {
                evidence.unreadable_since = None;
            }
            if !read.approvals_complete && evidence.has_open_approval() {
                evidence.unreadable_since.get_or_insert(now);
            }
        }
        tasks.tasks.values().any(|evidence| {
            evidence.has_open_approval()
                && evidence
                    .unreadable_since
                    .is_some_and(|since| now.saturating_duration_since(since) < MAX_SWITCH_DEFERRAL)
        })
    }

    pub(super) fn fence_settled(&self, task: &str, requests: &[RuntimeRequest]) {
        let settled: Vec<RequestKey> = requests
            .iter()
            .filter(|request| {
                !matches!(
                    request.status(),
                    RequestStatus::Pending | RequestStatus::Submitting
                )
            })
            .map(|request| (request.parts().body.kind(), request.parts().id.clone()))
            .collect();
        if settled.is_empty() {
            return;
        }
        let mut tasks = self.locked();
        let evidence = tasks.entry(task);
        for key in settled {
            evidence.open.remove(&key);
            evidence.fence(key);
        }
    }

    pub(super) fn take_bump_due(&self) -> bool {
        std::mem::take(&mut self.locked().bump_due)
    }

    pub(super) fn is_connection_incomplete(&self) -> bool {
        self.locked().invalidation_lost
    }

    pub(super) fn vanish(&self, task: &str) -> Verdict {
        let mut tasks = self.locked();
        let evidence = tasks.entry(task);
        if evidence.open.is_empty() {
            return Verdict::Current;
        }
        evidence.open.clear();
        evidence.invalidated = true;
        Verdict::Vanished
    }

    pub(super) fn published(&self, task: &str, key: RequestKey, open: bool) {
        let mut tasks = self.locked();
        let evidence = tasks.entry(task);
        evidence.open.remove(&key);
        if open {
            evidence.open.insert(key);
            return;
        }
        evidence.fence(key);
    }

    pub(super) fn has_open_requests(&self, task: &str) -> bool {
        self.locked()
            .tasks
            .get(task)
            .is_some_and(|evidence| !evidence.open.is_empty())
    }

    pub(super) fn has_lost_open_evidence(&self) -> bool {
        self.locked().open_lost
    }

    pub(super) fn is_incomplete(&self, task: &str) -> bool {
        let tasks = self.locked();
        tasks.invalidation_lost
            || tasks
                .tasks
                .get(task)
                .is_some_and(|evidence| evidence.invalidated)
    }

    #[cfg(test)]
    pub(super) fn tracked(&self) -> usize {
        self.locked().tasks.len()
    }
}

#[cfg(test)]
#[path = "thread_requests_evidence_tests.rs"]
mod tests;
