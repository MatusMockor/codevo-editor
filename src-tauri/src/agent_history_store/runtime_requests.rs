pub(super) use super::runtime_request_reads::read;
pub(crate) use super::runtime_request_store::HistoryRuntimeRequestStore;
pub(super) use super::runtime_request_turn_states::retain_turn_states;
use super::runtime_request_turn_states::{SuppressedRequest, TurnState};
use crate::agent_runtime_requests::model::{
    from_wire_name, wire_name, CloseReason, RequestBody, RequestKind, RequestProvider,
    RequestResolution, RequestStatus, MAX_SAFE_INTEGER,
};
use crate::agent_runtime_requests::observed::{
    ClosedStatus, DigestedState, ObservedRequest, ObservedState,
};
use crate::agent_runtime_requests::store::{
    AnswerIntent, ApplyReport, IntentReceipt, IntentSettle, IntentSettlement, RecoveryReport,
    StoreError, StoreErrorKind, TurnKey, TurnObservation, MAX_REQUESTS_PER_THREAD,
    MAX_REQUESTS_PER_TURN, MAX_REQUEST_BODY_BYTES, MAX_REQUEST_OUTCOME_BYTES,
    ORPHAN_REQUEST_RETENTION_MS,
};
use rusqlite::{
    params, types::ValueRef, Connection, ErrorCode, OptionalExtension, Row, Transaction,
    TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub(super) const FULL_BODY_FORMAT: i64 = 1;
const OMITTED_BODY_FORMAT: i64 = 0;
const KEEP_OUTCOME: i64 = 0;
const CLEAR_OUTCOME: i64 = 1;
const REPLACE_OUTCOME: i64 = 2;

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    super::sql(connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS runtime_requests(
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        run_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        reg_index INTEGER NOT NULL,
        format INTEGER NOT NULL,
        body TEXT NOT NULL,
        outcome TEXT,
        anchor_tool_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        PRIMARY KEY(thread_id,turn_id,request_id)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS runtime_requests_open ON runtime_requests(status)
            WHERE status IN ('pending','submitting');
        CREATE INDEX IF NOT EXISTS runtime_requests_order
            ON runtime_requests(thread_id,created_at,turn_id,reg_index);
        CREATE TABLE IF NOT EXISTS runtime_request_marks(
        thread_id TEXT PRIMARY KEY,
        pruned INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS runtime_request_turns(
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        applied_sequence INTEGER NOT NULL,
        suppressed TEXT NOT NULL,
        incarnation INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(thread_id,turn_id)) WITHOUT ROWID;",
    ))?;
    let incarnation_column: i64 = super::sql(connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('runtime_request_turns') WHERE name='incarnation'",
        [],
        |row| row.get(0),
    ))?;
    if incarnation_column == 0 {
        super::sql(connection.execute_batch(
            "ALTER TABLE runtime_request_turns ADD COLUMN incarnation INTEGER NOT NULL DEFAULT 0;",
        ))?;
    }
    Ok(())
}

pub(super) fn delete(connection: &Connection, thread_id: &str) -> Result<(), String> {
    super::sql(connection.execute(
        "DELETE FROM runtime_requests WHERE thread_id=?1",
        [thread_id],
    ))?;
    super::sql(connection.execute(
        "DELETE FROM runtime_request_marks WHERE thread_id=?1",
        [thread_id],
    ))?;
    super::sql(connection.execute(
        "DELETE FROM runtime_request_turns WHERE thread_id=?1",
        [thread_id],
    ))?;
    Ok(())
}

pub(super) fn store_error(error: rusqlite::Error) -> StoreError {
    let kind = match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => StoreErrorKind::Busy,
        Some(ErrorCode::DiskFull) => StoreErrorKind::Full,
        _ => StoreErrorKind::Unavailable,
    };
    StoreError::new(kind, error.to_string())
}

pub(super) fn stored<T>(result: rusqlite::Result<T>) -> Result<T, StoreError> {
    result.map_err(store_error)
}

pub(super) fn integer(value: u64) -> i64 {
    i64::try_from(value.min(MAX_SAFE_INTEGER)).unwrap_or(i64::MAX)
}

pub(super) fn name<T: Serialize>(variant: &T) -> String {
    wire_name(variant).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EncodedBody<'a> {
    provider: RequestProvider,
    body: &'a RequestBody,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DecodedBody {
    pub(super) provider: RequestProvider,
    pub(super) body: RequestBody,
}

fn encode_body(request: &ObservedRequest) -> Option<String> {
    let encoded = serde_json::to_string(&EncodedBody {
        provider: request.provider,
        body: &request.body,
    })
    .ok()?;
    if encoded.len() > MAX_REQUEST_BODY_BYTES {
        return None;
    }
    Some(encoded)
}

fn encode_outcome(resolution: &RequestResolution) -> Option<String> {
    let encoded = serde_json::to_string(resolution).ok()?;
    if encoded.len() > MAX_REQUEST_OUTCOME_BYTES {
        return None;
    }
    Some(encoded)
}

enum OutcomeChange {
    Keep,
    Clear,
    Replace(Option<String>),
}

impl OutcomeChange {
    fn mode(&self) -> i64 {
        match self {
            Self::Keep => KEEP_OUTCOME,
            Self::Clear => CLEAR_OUTCOME,
            Self::Replace(_) => REPLACE_OUTCOME,
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Self::Replace(text) => text.as_deref(),
            Self::Keep | Self::Clear => None,
        }
    }

    fn omits_required_outcome(&self) -> bool {
        matches!(self, Self::Replace(None))
    }
}

struct Closing {
    status: RequestStatus,
    reason: Option<CloseReason>,
    outcome: OutcomeChange,
}

enum Listing<'a> {
    Pending,
    Resolved(Option<&'a RequestResolution>),
    Closed {
        status: ClosedStatus,
        reason: CloseReason,
    },
}

impl<'a> Listing<'a> {
    fn observed(state: &'a ObservedState) -> Self {
        match state {
            ObservedState::Pending => Self::Pending,
            ObservedState::Resolved(sent) => Self::Resolved(Some(sent)),
            ObservedState::Closed { status, reason } => Self::Closed {
                status: *status,
                reason: *reason,
            },
        }
    }

    fn digested(state: DigestedState) -> Self {
        match state {
            DigestedState::Pending => Self::Pending,
            DigestedState::Resolved => Self::Resolved(None),
            DigestedState::Closed { status, reason } => Self::Closed { status, reason },
        }
    }
}

impl Closing {
    fn listed(current: RequestStatus, listing: &Listing<'_>) -> Option<Self> {
        let closing = match (current, listing) {
            (RequestStatus::Pending | RequestStatus::Submitting, Listing::Resolved(Some(sent))) => {
                Self {
                    status: RequestStatus::Resolved,
                    reason: None,
                    outcome: OutcomeChange::Replace(encode_outcome(sent)),
                }
            }
            (RequestStatus::Submitting, Listing::Resolved(None)) => Self {
                status: RequestStatus::Resolved,
                reason: None,
                outcome: OutcomeChange::Keep,
            },
            (RequestStatus::Pending, Listing::Resolved(None)) => Self {
                status: RequestStatus::Resolved,
                reason: None,
                outcome: OutcomeChange::Replace(None),
            },
            (RequestStatus::Pending, Listing::Closed { status, reason }) => Self {
                status: status.status(),
                reason: Some(*reason),
                outcome: OutcomeChange::Clear,
            },
            (RequestStatus::Submitting, Listing::Closed { .. }) => Self::unconfirmed(),
            _ => return None,
        };
        closing.reachable_from(current)
    }

    fn absent(current: RequestStatus) -> Option<Self> {
        let closing = match current {
            RequestStatus::Pending => Self {
                status: RequestStatus::Expired,
                reason: Some(CloseReason::TurnEnded),
                outcome: OutcomeChange::Clear,
            },
            RequestStatus::Submitting => Self::unconfirmed(),
            _ => return None,
        };
        closing.reachable_from(current)
    }

    fn unconfirmed() -> Self {
        Self {
            status: RequestStatus::Expired,
            reason: Some(CloseReason::AnswerUnconfirmed),
            outcome: OutcomeChange::Keep,
        }
    }

    fn reachable_from(self, current: RequestStatus) -> Option<Self> {
        let direct = current.may_become(self.status);
        let through_submitting = current.may_become(RequestStatus::Submitting)
            && RequestStatus::Submitting.may_become(self.status);
        if !direct && !through_submitting {
            return None;
        }
        Some(self)
    }
}

struct KnownRow {
    kind: Option<RequestKind>,
    status: Option<RequestStatus>,
    run_id: String,
    reg_index: i64,
}

pub(super) fn text_column(row: &Row<'_>, column: usize) -> Option<String> {
    let ValueRef::Text(raw) = row.get_ref(column).ok()? else {
        return None;
    };
    std::str::from_utf8(raw).ok().map(str::to_string)
}

pub(super) fn integer_column(row: &Row<'_>, column: usize) -> Option<i64> {
    let ValueRef::Integer(value) = row.get_ref(column).ok()? else {
        return None;
    };
    Some(value)
}

fn tombstoned(transaction: &Transaction<'_>, thread_id: &str) -> Result<bool, StoreError> {
    stored(transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1)",
        [thread_id],
        |row| row.get(0),
    ))
}

fn turn_rows(
    transaction: &Transaction<'_>,
    key: &TurnKey,
) -> Result<HashMap<String, KnownRow>, StoreError> {
    let mut statement = stored(transaction.prepare(
        "SELECT request_id,kind,status,run_id,reg_index FROM runtime_requests
         WHERE thread_id=?1 AND turn_id=?2",
    ))?;
    let rows = stored(statement.query_map([&key.thread_id, &key.turn_id], |row| {
        Ok(text_column(row, 0).map(|request_id| {
            let known = KnownRow {
                kind: text_column(row, 1).and_then(|kind| from_wire_name(&kind)),
                status: text_column(row, 2).and_then(|status| from_wire_name(&status)),
                run_id: text_column(row, 3).unwrap_or_default(),
                reg_index: integer_column(row, 4).unwrap_or(0),
            };
            (request_id, known)
        }))
    }))?;
    let mut known = HashMap::new();
    for row in rows {
        let Some((request_id, row)) = stored(row)? else {
            continue;
        };
        known.insert(request_id, row);
    }
    Ok(known)
}

fn mark(
    transaction: &Transaction<'_>,
    thread_id: &str,
    pruned: u64,
    skipped: u64,
) -> Result<(), StoreError> {
    if pruned == 0 && skipped == 0 {
        return Ok(());
    }
    stored(transaction.execute(
        "INSERT INTO runtime_request_marks(thread_id,pruned,skipped) VALUES(?1,?2,?3)
         ON CONFLICT(thread_id) DO UPDATE SET
            pruned=pruned+excluded.pruned,
            skipped=skipped+excluded.skipped",
        params![thread_id, integer(pruned), integer(skipped)],
    ))?;
    Ok(())
}

#[derive(Clone, Copy)]
enum RetentionScope {
    Turn,
    Thread,
}

impl RetentionScope {
    const ALL: [Self; 2] = [Self::Turn, Self::Thread];

    fn limit(self) -> usize {
        match self {
            Self::Turn => MAX_REQUESTS_PER_TURN,
            Self::Thread => MAX_REQUESTS_PER_THREAD,
        }
    }

    fn turn_filter(self, key: &TurnKey) -> &str {
        match self {
            Self::Turn => &key.turn_id,
            Self::Thread => "",
        }
    }
}

struct PrunedRow {
    turn_id: String,
    request_id: String,
    kind: Option<RequestKind>,
    run_id: String,
}

fn prune_oldest_closed(
    transaction: &Transaction<'_>,
    key: &TurnKey,
    scope: RetentionScope,
) -> Result<Option<PrunedRow>, StoreError> {
    let turn_filter = scope.turn_filter(key);
    let victim: Option<Option<PrunedRow>> = stored(
        transaction
            .query_row(
                "SELECT turn_id,request_id,kind,run_id FROM runtime_requests
                 WHERE thread_id=?1 AND (?2='' OR turn_id=?2)
                   AND status IN ('resolved','cancelled','expired','timedOut')
                 ORDER BY created_at,turn_id,reg_index LIMIT 1",
                [&key.thread_id, turn_filter],
                |row| {
                    let (Some(turn_id), Some(request_id)) =
                        (text_column(row, 0), text_column(row, 1))
                    else {
                        return Ok(None);
                    };
                    Ok(Some(PrunedRow {
                        turn_id,
                        request_id,
                        kind: text_column(row, 2).and_then(|kind| from_wire_name(&kind)),
                        run_id: text_column(row, 3).unwrap_or_default(),
                    }))
                },
            )
            .optional(),
    )?;
    let Some(victim) = victim.flatten() else {
        return Ok(None);
    };
    stored(transaction.execute(
        "DELETE FROM runtime_requests WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3",
        params![key.thread_id, victim.turn_id, victim.request_id],
    ))?;
    Ok(Some(victim))
}

fn count(
    transaction: &Transaction<'_>,
    key: &TurnKey,
    scope: RetentionScope,
) -> Result<usize, StoreError> {
    let turn_filter = scope.turn_filter(key);
    let total: i64 = stored(transaction.query_row(
        "SELECT COUNT(*) FROM runtime_requests WHERE thread_id=?1 AND (?2='' OR turn_id=?2)",
        [&key.thread_id, turn_filter],
        |row| row.get(0),
    ))?;
    Ok(usize::try_from(total).unwrap_or(usize::MAX))
}

struct Reconciliation<'a> {
    transaction: &'a Transaction<'a>,
    run_id: &'a str,
    observation: &'a TurnObservation,
    state: TurnState,
    report: ApplyReport,
}

struct ListedRequest<'a> {
    id: &'a str,
    kind: RequestKind,
    listing: Listing<'a>,
    revision: Option<u64>,
}

fn revision_of(observation: &TurnObservation, revision: Option<u64>) -> i64 {
    integer(revision.unwrap_or(observation.revision))
}

impl Reconciliation<'_> {
    fn answer_matches(
        &self,
        request_id: &str,
        sent: Option<&RequestResolution>,
    ) -> Result<bool, StoreError> {
        let Some(sent) = sent.and_then(encode_outcome) else {
            return Ok(true);
        };
        let key = &self.observation.key;
        let saved: Option<(Option<i64>, Option<String>)> = stored(
            self.transaction
                .query_row(
                    "SELECT format,outcome FROM runtime_requests
                     WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3",
                    params![key.thread_id, key.turn_id, request_id],
                    |row| Ok((integer_column(row, 0), text_column(row, 1))),
                )
                .optional(),
        )?;
        let Some((Some(FULL_BODY_FORMAT), Some(outcome))) = saved else {
            return Ok(true);
        };
        Ok(outcome == sent)
    }

    fn collides(
        &self,
        row: &KnownRow,
        from: RequestStatus,
        request: &ListedRequest<'_>,
    ) -> Result<bool, StoreError> {
        if row.run_id != self.run_id {
            return Ok(true);
        }
        if !from.is_terminal() {
            return Ok(false);
        }
        match request.listing {
            Listing::Pending => Ok(true),
            Listing::Closed { .. } => Ok(from == RequestStatus::Resolved),
            Listing::Resolved(_) if from != RequestStatus::Resolved => Ok(true),
            Listing::Resolved(sent) => Ok(!self.answer_matches(request.id, sent)?),
        }
    }

    fn reconcile(&mut self, row: &KnownRow, request: &ListedRequest<'_>) -> Result<(), StoreError> {
        let Some(kind) = row.kind else {
            return Ok(());
        };
        if kind != request.kind {
            self.report.skipped += 1;
            return Ok(());
        }
        let Some(from) = row.status else {
            return Ok(());
        };
        if self.collides(row, from, request)? {
            self.report.skipped += 1;
            return Ok(());
        }
        let Some(closing) = Closing::listed(from, &request.listing) else {
            return Ok(());
        };
        let step = Advance {
            run_id: self.run_id,
            key: &self.observation.key,
            request_id: request.id,
            from,
            version: revision_of(self.observation, request.revision),
            at: integer(self.observation.observed_at_epoch_ms),
        };
        let advanced = advance(self.transaction, &step, &closing)?;
        if advanced.is_taken() {
            self.report.transitions += 1;
        }
        if advanced == Advanced::TakenWithoutAnswer {
            self.report.lost_answers += 1;
        }
        Ok(())
    }

    fn suppress(&mut self, pruned: PrunedRow) -> Result<(), StoreError> {
        let Some(kind) = pruned.kind.filter(|_| pruned.run_id == self.run_id) else {
            return Ok(());
        };
        let key = &self.observation.key;
        let request = SuppressedRequest {
            id: pruned.request_id,
            kind,
        };
        if pruned.turn_id == key.turn_id {
            self.state.suppress(request);
            return Ok(());
        }
        let mut other = TurnState::load(
            self.transaction,
            &key.thread_id,
            &pruned.turn_id,
            self.run_id,
        )?;
        if !other.stored {
            return Ok(());
        }
        other.suppress(request);
        other.save(
            self.transaction,
            &key.thread_id,
            &pruned.turn_id,
            self.run_id,
        )
    }

    fn make_room(&mut self) -> Result<bool, StoreError> {
        let key = &self.observation.key;
        for scope in RetentionScope::ALL {
            if count(self.transaction, key, scope)? < scope.limit() {
                continue;
            }
            let Some(pruned) = prune_oldest_closed(self.transaction, key, scope)? else {
                return Ok(false);
            };
            self.report.pruned += 1;
            self.suppress(pruned)?;
        }
        Ok(true)
    }
}

fn insert(
    reconciliation: &mut Reconciliation<'_>,
    request: &ObservedRequest,
    reg_index: i64,
) -> Result<bool, StoreError> {
    if !reconciliation.make_room()? {
        reconciliation.report.skipped += 1;
        return Ok(false);
    }
    let observation = reconciliation.observation;
    let key = &observation.key;
    let closing = Closing::listed(RequestStatus::Pending, &Listing::observed(&request.state));
    let status = closing
        .as_ref()
        .map_or(RequestStatus::Pending, |closing| closing.status);
    let outcome_omitted = closing
        .as_ref()
        .is_some_and(|closing| closing.outcome.omits_required_outcome());
    let body = encode_body(request).filter(|_| !outcome_omitted);
    let format = match body {
        Some(_) => FULL_BODY_FORMAT,
        None => OMITTED_BODY_FORMAT,
    };
    let at = integer(observation.observed_at_epoch_ms);
    let created_at = at.min(integer(observation.first_observed_at_epoch_ms));
    stored(reconciliation.transaction.execute(
        "INSERT INTO runtime_requests(thread_id,turn_id,request_id,kind,status,reason,run_id,
            version,reg_index,format,body,outcome,anchor_tool_id,created_at,updated_at,resolved_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,NULL,?13,?14,?15)",
        params![
            key.thread_id,
            key.turn_id,
            request.id,
            name(&request.body.kind()),
            name(&status),
            closing
                .as_ref()
                .and_then(|closing| closing.reason)
                .map(|reason| name(&reason)),
            reconciliation.run_id,
            revision_of(observation, request.revision),
            reg_index,
            format,
            body.unwrap_or_default(),
            closing.as_ref().and_then(|closing| closing.outcome.text()),
            created_at,
            at,
            closing.as_ref().map(|_| at),
        ],
    ))?;
    reconciliation.report.transitions += 1;
    if outcome_omitted {
        reconciliation.report.lost_answers += 1;
    }
    Ok(true)
}

struct Advance<'a> {
    run_id: &'a str,
    key: &'a TurnKey,
    request_id: &'a str,
    from: RequestStatus,
    version: i64,
    at: i64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Advanced {
    Refused,
    Taken,
    TakenWithoutAnswer,
}

impl Advanced {
    fn is_taken(self) -> bool {
        self != Self::Refused
    }
}

fn advance(
    transaction: &Transaction<'_>,
    advance: &Advance<'_>,
    closing: &Closing,
) -> Result<Advanced, StoreError> {
    let answer_missing: Option<bool> = stored(
        transaction
            .query_row(
                "UPDATE runtime_requests SET status=?5,reason=?6,version=?7,updated_at=?8,
                    resolved_at=?8,
                    outcome=CASE ?9 WHEN 0 THEN outcome WHEN 1 THEN NULL ELSE ?10 END,
                    format=CASE WHEN ?5='resolved'
                        AND (CASE ?9 WHEN 0 THEN outcome WHEN 1 THEN NULL ELSE ?10 END) IS NULL
                        THEN 0 ELSE format END,
                    body=CASE WHEN ?5='resolved'
                        AND (CASE ?9 WHEN 0 THEN outcome WHEN 1 THEN NULL ELSE ?10 END) IS NULL
                        THEN '' ELSE body END
                 WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3 AND run_id=?4
                   AND status=?11 AND version<?7 AND format IN (0,1)
                 RETURNING status='resolved' AND outcome IS NULL",
                params![
                    advance.key.thread_id,
                    advance.key.turn_id,
                    advance.request_id,
                    advance.run_id,
                    name(&closing.status),
                    closing.reason.map(|reason| name(&reason)),
                    advance.version,
                    advance.at,
                    closing.outcome.mode(),
                    closing.outcome.text(),
                    name(&advance.from),
                ],
                |row| row.get(0),
            )
            .optional(),
    )?;
    Ok(match answer_missing {
        None => Advanced::Refused,
        Some(false) => Advanced::Taken,
        Some(true) => Advanced::TakenWithoutAnswer,
    })
}

fn close_predecessor_rows(
    transaction: &Transaction<'_>,
    run_id: &str,
    observation: &TurnObservation,
    known: &mut HashMap<String, KnownRow>,
) -> Result<u64, StoreError> {
    let mut closed = 0;
    for (request_id, row) in known.iter_mut() {
        if row.run_id != run_id {
            continue;
        }
        let Some((from, closing)) = row
            .status
            .and_then(|from| Closing::absent(from).map(|closing| (from, closing)))
        else {
            continue;
        };
        let step = Advance {
            run_id,
            key: &observation.key,
            request_id,
            from,
            version: integer(observation.revision),
            at: integer(observation.observed_at_epoch_ms),
        };
        if advance(transaction, &step, &closing)?.is_taken() {
            row.status = Some(closing.status);
            closed += 1;
        }
    }
    Ok(closed)
}

pub(super) fn apply_snapshot(
    connection: &mut Connection,
    run_id: &str,
    observation: &TurnObservation,
) -> Result<ApplyReport, StoreError> {
    let transaction = stored(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let key = &observation.key;
    if tombstoned(&transaction, &key.thread_id)? {
        return Ok(ApplyReport {
            tombstoned: true,
            ..ApplyReport::default()
        });
    }
    let saved = TurnState::load(&transaction, &key.thread_id, &key.turn_id, run_id)?;
    let incarnation = integer(observation.incarnation);
    let version = integer(observation.turn.sequence);
    if saved.stored && incarnation < saved.incarnation {
        return Ok(ApplyReport {
            superseded: true,
            ..ApplyReport::default()
        });
    }
    let continues = saved.stored && incarnation == saved.incarnation;
    if continues && version <= saved.applied_sequence {
        return Ok(ApplyReport {
            stale: true,
            ..ApplyReport::default()
        });
    }
    let mut known = turn_rows(&transaction, key)?;
    let mut taken_over = 0;
    let mut state = saved;
    if !continues {
        taken_over = close_predecessor_rows(&transaction, run_id, observation, &mut known)?;
        state = TurnState {
            incarnation,
            ..TurnState::default()
        };
    }
    let turn = &observation.turn;
    let nothing_observed =
        turn.requests.is_empty() && turn.digested.is_empty() && turn.rejected.is_empty();
    if known.is_empty() && nothing_observed && !continues {
        return Ok(ApplyReport::default());
    }
    let at = integer(observation.observed_at_epoch_ms);
    let mut next_index = known
        .values()
        .map(|row| row.reg_index + 1)
        .max()
        .unwrap_or(0);
    let mut listed: HashSet<&str> = turn.rejected.iter().map(String::as_str).collect();
    let mut reconciliation = Reconciliation {
        transaction: &transaction,
        run_id,
        observation,
        state,
        report: ApplyReport {
            transitions: taken_over,
            ..ApplyReport::default()
        },
    };
    for request in &turn.requests {
        listed.insert(&request.id);
        let Some(row) = known.get(&request.id) else {
            if reconciliation.state.suppresses(&request.id) {
                continue;
            }
            if insert(&mut reconciliation, request, next_index)? {
                next_index += 1;
            }
            continue;
        };
        let listed_request = ListedRequest {
            id: &request.id,
            kind: request.body.kind(),
            listing: Listing::observed(&request.state),
            revision: request.revision,
        };
        reconciliation.reconcile(row, &listed_request)?;
    }
    for request in &turn.digested {
        listed.insert(&request.id);
        let Some(row) = known.get(&request.id) else {
            if !reconciliation.state.suppresses(&request.id) {
                reconciliation.report.skipped += 1;
            }
            continue;
        };
        let listed_request = ListedRequest {
            id: &request.id,
            kind: request.kind,
            listing: Listing::digested(request.state),
            revision: request.revision,
        };
        reconciliation.reconcile(row, &listed_request)?;
    }
    for (request_id, row) in &known {
        if listed.contains(request_id.as_str()) || row.run_id != run_id {
            continue;
        }
        let Some((from, closing)) = row
            .status
            .and_then(|from| Closing::absent(from).map(|closing| (from, closing)))
        else {
            continue;
        };
        let step = Advance {
            run_id,
            key,
            request_id,
            from,
            version: integer(observation.revision),
            at,
        };
        if advance(&transaction, &step, &closing)?.is_taken() {
            reconciliation.report.transitions += 1;
        }
    }
    let Reconciliation {
        mut state, report, ..
    } = reconciliation;
    state.applied_sequence = version;
    state.save(&transaction, &key.thread_id, &key.turn_id, run_id)?;
    mark(
        &transaction,
        &key.thread_id,
        report.pruned,
        report.skipped + report.lost_answers,
    )?;
    stored(transaction.commit())?;
    Ok(report)
}

fn intent_is_valid(intent: &AnswerIntent, kind: &str, format: i64, body: &str) -> bool {
    if kind != name(&intent.resolution.kind()) {
        return false;
    }
    if format == OMITTED_BODY_FORMAT {
        return true;
    }
    if format != FULL_BODY_FORMAT {
        return false;
    }
    let Ok(decoded) = serde_json::from_str::<DecodedBody>(body) else {
        return false;
    };
    intent
        .resolution
        .validate_for(&intent.request_id, decoded.provider, &decoded.body)
        .is_ok()
}

struct IntentTarget {
    kind: String,
    format: i64,
    body: String,
    status: String,
    run_id: String,
    version: i64,
    outcome: Option<String>,
}

impl IntentTarget {
    fn read(row: &Row<'_>) -> Option<Self> {
        Some(Self {
            kind: text_column(row, 0)?,
            format: integer_column(row, 1)?,
            body: text_column(row, 2)?,
            status: text_column(row, 3)?,
            run_id: text_column(row, 4)?,
            version: integer_column(row, 5)?,
            outcome: text_column(row, 6),
        })
    }

    fn is_the_saved_answer(&self, intent: &AnswerIntent) -> bool {
        let sent = encode_outcome(&intent.resolution);
        self.status == name(&RequestStatus::Resolved)
            && self.format == FULL_BODY_FORMAT
            && sent.is_some()
            && self.outcome == sent
    }
}

fn intent_target(
    transaction: &Transaction<'_>,
    intent: &AnswerIntent,
) -> Result<Option<IntentTarget>, StoreError> {
    let target: Option<Option<IntentTarget>> = stored(
        transaction
            .query_row(
                "SELECT kind,format,body,status,run_id,version,outcome FROM runtime_requests
                 WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3",
                params![intent.key.thread_id, intent.key.turn_id, intent.request_id],
                |row| Ok(IntentTarget::read(row)),
            )
            .optional(),
    )?;
    Ok(target.flatten())
}

pub(super) fn record_intent(
    connection: &mut Connection,
    run_id: &str,
    intent: &AnswerIntent,
) -> Result<IntentReceipt, StoreError> {
    let transaction = stored(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let key = &intent.key;
    if tombstoned(&transaction, &key.thread_id)? {
        return Ok(IntentReceipt::ThreadDeleted);
    }
    let turn = TurnState::load(&transaction, &key.thread_id, &key.turn_id, run_id)?;
    if !turn.stored || turn.incarnation != integer(intent.incarnation) {
        return Ok(IntentReceipt::NotJournaled);
    }
    let Some(target) = intent_target(&transaction, intent)? else {
        return Ok(IntentReceipt::NotJournaled);
    };
    if target.run_id != run_id {
        return Ok(IntentReceipt::NotJournaled);
    }
    if target.is_the_saved_answer(intent) {
        return Ok(IntentReceipt::AlreadyAnswered);
    }
    if target.status != name(&RequestStatus::Pending) || target.version >= integer(intent.version) {
        return Ok(IntentReceipt::NotJournaled);
    }
    if !intent_is_valid(intent, &target.kind, target.format, &target.body) {
        return Ok(IntentReceipt::Refused);
    }
    let outcome = encode_outcome(&intent.resolution);
    let receipt = match outcome {
        Some(_) => IntentReceipt::Recorded,
        None => IntentReceipt::RecordedWithoutAnswer,
    };
    stored(transaction.execute(
        "UPDATE runtime_requests SET status='submitting',outcome=?5,version=?6,updated_at=?7
         WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3 AND run_id=?4 AND status='pending'",
        params![
            key.thread_id,
            key.turn_id,
            intent.request_id,
            run_id,
            outcome,
            integer(intent.version),
            integer(intent.at_epoch_ms),
        ],
    ))?;
    stored(transaction.commit())?;
    Ok(receipt)
}

pub(super) fn settle_intent(
    connection: &mut Connection,
    run_id: &str,
    settle: &IntentSettle,
) -> Result<bool, StoreError> {
    if settle.version <= settle.intent_version {
        return Ok(false);
    }
    let (status, reason, outcome) = match settle.settlement {
        IntentSettlement::Reverted => (RequestStatus::Pending, None, CLEAR_OUTCOME),
        IntentSettlement::DeliveryFailed => (
            RequestStatus::Expired,
            Some(CloseReason::DeliveryFailed),
            CLEAR_OUTCOME,
        ),
        IntentSettlement::Unconfirmed => (
            RequestStatus::Expired,
            Some(CloseReason::AnswerUnconfirmed),
            KEEP_OUTCOME,
        ),
    };
    if !RequestStatus::Submitting.may_become(status) {
        return Ok(false);
    }
    let at = integer(settle.at_epoch_ms);
    let changed = stored(connection.execute(
        "UPDATE runtime_requests SET status=?5,reason=?6,version=?7,updated_at=?8,resolved_at=?9,
            outcome=CASE ?10 WHEN 0 THEN outcome ELSE NULL END
         WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3 AND run_id=?4
           AND status='submitting' AND version=?11
           AND EXISTS(SELECT 1 FROM runtime_request_turns AS turn
                WHERE turn.thread_id=?1 AND turn.turn_id=?2 AND turn.run_id=?4
                  AND turn.incarnation=?12)",
        params![
            settle.key.thread_id,
            settle.key.turn_id,
            settle.request_id,
            run_id,
            name(&status),
            reason.map(|reason| name(&reason)),
            integer(settle.version),
            at,
            status.is_terminal().then_some(at),
            outcome,
            integer(settle.intent_version),
            integer(settle.incarnation),
        ],
    ))?;
    Ok(changed == 1)
}

pub(super) fn recover(
    connection: &mut Connection,
    run_id: &str,
    now_epoch_ms: u64,
) -> Result<RecoveryReport, StoreError> {
    let transaction = stored(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let now = integer(now_epoch_ms);
    let purged = stored(transaction.execute(
        "DELETE FROM runtime_requests WHERE thread_id IN (SELECT thread_id FROM tombstones)",
        [],
    ))?;
    stored(transaction.execute(
        "DELETE FROM runtime_request_marks WHERE thread_id IN (SELECT thread_id FROM tombstones)",
        [],
    ))?;
    stored(transaction.execute(
        "DELETE FROM runtime_request_turns WHERE run_id<>?1
            OR thread_id IN (SELECT thread_id FROM tombstones)",
        [run_id],
    ))?;
    let expired = stored(transaction.execute(
        "UPDATE runtime_requests SET status='expired',reason='appRestarted',outcome=NULL,
            version=version+1,updated_at=?2,resolved_at=?2
         WHERE status='pending' AND run_id<>?1",
        params![run_id, now],
    ))?;
    let unconfirmed = stored(transaction.execute(
        "UPDATE runtime_requests SET status='expired',reason='answerUnconfirmed',
            version=version+1,updated_at=?2,resolved_at=?2
         WHERE status='submitting' AND run_id<>?1",
        params![run_id, now],
    ))?;
    let swept = stored(transaction.execute(
        "DELETE FROM runtime_requests
         WHERE run_id<>?1 AND updated_at<?2
           AND thread_id NOT IN (SELECT thread_id FROM threads)",
        params![
            run_id,
            now.saturating_sub(integer(ORPHAN_REQUEST_RETENTION_MS))
        ],
    ))?;
    stored(transaction.execute(
        "DELETE FROM runtime_request_marks
         WHERE thread_id NOT IN (SELECT thread_id FROM threads)
           AND thread_id NOT IN (SELECT thread_id FROM runtime_requests)",
        [],
    ))?;
    stored(transaction.commit())?;
    let counted = |rows: usize| u64::try_from(rows).unwrap_or(u64::MAX);
    Ok(RecoveryReport {
        expired: counted(expired),
        unconfirmed: counted(unconfirmed),
        purged: counted(purged),
        swept: counted(swept),
    })
}
