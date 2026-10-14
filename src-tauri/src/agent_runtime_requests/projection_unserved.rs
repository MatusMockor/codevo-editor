use super::{
    PageBuilder, Position, ProjectionError, RequestProjection, ThreadRequestsPage, TurnView,
};
use crate::agent_runtime_requests::model::{
    JournalState, RuntimeRequest, ThreadRequests, ThreadRequestsParts,
};
use crate::agent_runtime_requests::projection_overlay::Candidate;
use crate::agent_runtime_requests::scopes::HistoryScope;
use crate::agent_runtime_requests::store::{
    StoreError, StoredEntry, ThreadRead, ThreadRows, ThreadSummary,
};
use crate::agent_runtime_requests::unserved::Healed;
use std::time::{Duration, Instant};

struct NoRows;

impl ThreadRows for NoRows {
    fn summary(&mut self) -> Result<ThreadSummary, StoreError> {
        Ok(ThreadSummary::default())
    }

    fn entries(&mut self, _turn_id: &str) -> Result<Vec<StoredEntry>, StoreError> {
        Ok(Vec::new())
    }

    fn load(
        &mut self,
        _turn_id: &str,
        _request_id: &str,
    ) -> Result<Option<RuntimeRequest>, StoreError> {
        Ok(None)
    }
}

impl RequestProjection {
    pub(super) fn read_tracked(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        read: &mut ThreadRead<'_>,
    ) -> Result<(), StoreError> {
        self.read_tracked_at(scope, thread_id, Instant::now(), read)
    }

    fn read_tracked_at(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        now: Instant,
        read: &mut ThreadRead<'_>,
    ) -> Result<(), StoreError> {
        let unserved = self.journal.unserved();
        let mark = unserved.mark();
        let result = self
            .journal
            .read_thread(scope, thread_id, self.limits.read_budget, read);
        let Err(_) = &result else {
            if let Some(healed) = unserved.served(scope, mark) {
                self.readable_again(scope, healed);
            }
            return result;
        };
        if unserved.failed(scope, thread_id, now) {
            self.journal.request_rotation();
        }
        result
    }

    fn readable_again(&self, scope: &HistoryScope, healed: Healed) {
        for thread_id in &healed.threads {
            self.journal.reset_readable_thread(scope, thread_id);
        }
        if healed.rotate {
            self.journal.request_rotation();
        }
    }

    pub(super) fn history_incomplete(&self, scope: &HistoryScope, thread_id: &str) -> bool {
        self.journal.lost_history(scope, thread_id) || self.journal.unserved().degraded(scope)
    }

    pub(super) fn page_or_live(
        &self,
        epoch: &str,
        scope: &HistoryScope,
        (thread_id, turn_ids): (&str, &[String]),
        cursor: Option<&str>,
    ) -> Result<Option<ThreadRequestsPage>, ProjectionError> {
        match self.page_in(epoch, scope, (thread_id, turn_ids), cursor) {
            Err(ProjectionError::Store(_)) => self.live_page(epoch, scope, (thread_id, turn_ids)),
            read => read,
        }
    }

    fn live_page(
        &self,
        epoch: &str,
        scope: &HistoryScope,
        (thread_id, turn_ids): (&str, &[String]),
    ) -> Result<Option<ThreadRequestsPage>, ProjectionError> {
        let now = self.journal.now_epoch_ms();
        let turns: Vec<TurnView<'_>> = turn_ids
            .iter()
            .map(|turn_id| self.view(scope, (thread_id, turn_id)))
            .collect();
        let listed = turns
            .iter()
            .map(|turn| turn.listed(None, now))
            .collect::<Result<Vec<Vec<Candidate>>, StoreError>>()
            .map_err(ProjectionError::Store)?;
        let mut rows = NoRows;
        let mut builder = PageBuilder {
            rows: &mut rows,
            turns: &turns,
            listed: &listed,
            now,
            budget: self.limits.record_budget(),
            records: Vec::new(),
            used: 0,
            incomplete: false,
        };
        builder
            .fill(&Position::start())
            .map_err(ProjectionError::Store)?;
        let requests = builder.records;
        if self.journal.epoch() != epoch {
            return Ok(None);
        }
        let message = ThreadRequests::new(ThreadRequestsParts {
            workspace_id: None,
            thread_id: thread_id.to_string(),
            epoch: epoch.to_string(),
            journal: JournalState::Degraded,
            requests,
            truncated: true,
            unreadable: 0,
            reset: false,
        })
        .map_err(|_| ProjectionError::InvalidQuery)?;
        Ok(Some(ThreadRequestsPage {
            message,
            next_cursor: None,
        }))
    }

    pub fn probe_next(&self, now: Instant, interval: Duration) -> bool {
        let unserved = self.journal.unserved();
        let Some((scope, thread_id)) = unserved.due_probe(now, interval) else {
            return false;
        };
        let _ = self.read_tracked_at(&scope, &thread_id, now, &mut |rows| {
            rows.summary().map(drop)
        });
        true
    }

    pub fn next_probe_in(&self, now: Instant, interval: Duration) -> Duration {
        self.journal.unserved().next_probe_in(now, interval)
    }
}
