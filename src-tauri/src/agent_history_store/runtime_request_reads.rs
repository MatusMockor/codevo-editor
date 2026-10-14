use super::runtime_requests::{name, stored, DecodedBody, FULL_BODY_FORMAT};
use crate::agent_runtime_requests::model::{
    from_wire_name, CloseReason, RequestLifecycle, RequestParts, RequestResolution, RequestStatus,
    RuntimeRequest, MAX_RETAINED_REQUESTS_PER_THREAD,
};
use crate::agent_runtime_requests::store::{StoreError, StoredRequests, MAX_READ_REQUEST_BYTES};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;

const OPEN_STATUSES: &str = "('pending','submitting')";

struct StoredRow {
    turn_id: String,
    request_id: String,
    kind: String,
    status: String,
    reason: Option<String>,
    version: i64,
    reg_index: i64,
    format: i64,
    body: String,
    outcome: Option<String>,
    anchor_tool_id: Option<String>,
    created_at: i64,
    resolved_at: Option<i64>,
}

impl StoredRow {
    const COLUMNS: &'static str = "turn_id,request_id,kind,status,reason,version,reg_index,format,\
        body,outcome,anchor_tool_id,created_at,resolved_at";

    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            turn_id: row.get(0)?,
            request_id: row.get(1)?,
            kind: row.get(2)?,
            status: row.get(3)?,
            reason: row.get(4)?,
            version: row.get(5)?,
            reg_index: row.get(6)?,
            format: row.get(7)?,
            body: row.get(8)?,
            outcome: row.get(9)?,
            anchor_tool_id: row.get(10)?,
            created_at: row.get(11)?,
            resolved_at: row.get(12)?,
        })
    }

    fn lifecycle(&self, status: RequestStatus) -> Option<RequestLifecycle> {
        let resolution = match self.outcome.as_deref() {
            Some(outcome) => Some(serde_json::from_str::<RequestResolution>(outcome).ok()?),
            None => None,
        };
        let reason = match self.reason.as_deref() {
            Some(reason) => Some(from_wire_name::<CloseReason>(reason)?),
            None => None,
        };
        let resolved_at = match self.resolved_at {
            Some(resolved_at) => Some(u64::try_from(resolved_at).ok()?),
            None => None,
        };
        if status == RequestStatus::Pending {
            return (resolution.is_none() && reason.is_none() && resolved_at.is_none())
                .then_some(RequestLifecycle::Pending);
        }
        if status == RequestStatus::Submitting {
            return resolved_at
                .is_none()
                .then_some(RequestLifecycle::Submitting {
                    reason: reason.unwrap_or(CloseReason::Unknown),
                    resolution,
                });
        }
        let resolved_at_epoch_ms = resolved_at?;
        match (status, resolution) {
            (RequestStatus::Resolved, Some(resolution)) => Some(RequestLifecycle::Resolved {
                reason: reason.unwrap_or(CloseReason::Unknown),
                resolved_at_epoch_ms,
                resolution,
            }),
            (RequestStatus::Expired, resolution) => Some(RequestLifecycle::Expired {
                reason: reason?,
                resolved_at_epoch_ms,
                resolution,
            }),
            (RequestStatus::Cancelled, None) => Some(RequestLifecycle::Cancelled {
                reason: reason?,
                resolved_at_epoch_ms,
            }),
            (RequestStatus::TimedOut, None) => Some(RequestLifecycle::TimedOut {
                reason: reason?,
                resolved_at_epoch_ms,
            }),
            _ => None,
        }
    }

    fn decode(self) -> Option<RuntimeRequest> {
        if self.format != FULL_BODY_FORMAT {
            return None;
        }
        let status = from_wire_name::<RequestStatus>(&self.status)?;
        let lifecycle = self.lifecycle(status)?;
        let decoded = serde_json::from_str::<DecodedBody>(&self.body).ok()?;
        if name(&decoded.body.kind()) != self.kind {
            return None;
        }
        RuntimeRequest::new(RequestParts {
            id: self.request_id,
            turn_id: self.turn_id,
            provider: decoded.provider,
            created_at_epoch_ms: u64::try_from(self.created_at).ok()?,
            order: u64::try_from(self.reg_index).ok()?,
            version: u64::try_from(self.version).ok()?,
            anchor_tool_id: self.anchor_tool_id,
            body: decoded.body,
            lifecycle,
        })
        .ok()
    }
}

#[derive(Clone, Copy)]
enum Openness {
    Open,
    Closed,
}

impl Openness {
    fn membership(self) -> &'static str {
        match self {
            Self::Open => "IN",
            Self::Closed => "NOT IN",
        }
    }
}

struct Candidate {
    turn_id: String,
    request_id: String,
    bytes: usize,
}

pub(super) fn load_request(
    connection: &Connection,
    thread_id: &str,
    turn_id: &str,
    request_id: &str,
) -> Result<Option<RuntimeRequest>, StoreError> {
    let row: Option<Option<StoredRow>> = stored(
        connection
            .query_row(
                &format!(
                    "SELECT {} FROM runtime_requests
                     WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3",
                    StoredRow::COLUMNS
                ),
                params![thread_id, turn_id, request_id],
                |row| Ok(StoredRow::read(row).ok()),
            )
            .optional(),
    )?;
    Ok(row.flatten().and_then(StoredRow::decode))
}

impl Candidate {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        let bytes: i64 = row.get(2)?;
        Ok(Self {
            turn_id: row.get(0)?,
            request_id: row.get(1)?,
            bytes: usize::try_from(bytes).unwrap_or(usize::MAX),
        })
    }

    fn load(
        &self,
        connection: &Connection,
        thread_id: &str,
    ) -> Result<Option<RuntimeRequest>, StoreError> {
        load_request(connection, thread_id, &self.turn_id, &self.request_id)
    }
}

fn newest_candidates(
    connection: &Connection,
    thread_id: &str,
    openness: Openness,
    limit: usize,
) -> Result<Vec<Option<Candidate>>, StoreError> {
    let membership = openness.membership();
    let mut statement = stored(connection.prepare(&format!(
        "SELECT turn_id,request_id,octet_length(body)+IFNULL(octet_length(outcome),0)
         FROM runtime_requests
         WHERE thread_id=?1 AND status {membership} {OPEN_STATUSES}
         ORDER BY created_at DESC,turn_id DESC,reg_index DESC LIMIT ?2"
    )))?;
    let rows = stored(statement.query_map(
        params![thread_id, i64::try_from(limit).unwrap_or(i64::MAX)],
        |row| Ok(Candidate::read(row).ok()),
    ))?;
    let mut newest = Vec::new();
    for row in rows {
        newest.push(stored(row)?);
    }
    Ok(newest)
}

fn in_receiver_order(mut requests: Vec<RuntimeRequest>) -> Vec<RuntimeRequest> {
    let mut turn_starts: HashMap<String, u64> = HashMap::new();
    for request in &requests {
        let parts = request.parts();
        let start = turn_starts
            .entry(parts.turn_id.clone())
            .or_insert(parts.created_at_epoch_ms);
        *start = (*start).min(parts.created_at_epoch_ms);
    }
    requests.sort_by(|left, right| {
        let (left, right) = (left.parts(), right.parts());
        let start = |turn_id: &str| turn_starts.get(turn_id).copied().unwrap_or(0);
        start(&left.turn_id)
            .cmp(&start(&right.turn_id))
            .then_with(|| left.turn_id.cmp(&right.turn_id))
            .then_with(|| left.order.cmp(&right.order))
            .then_with(|| left.id.cmp(&right.id))
    });
    requests
}

pub(super) fn read(
    connection: &mut Connection,
    thread_id: &str,
    limit: usize,
) -> Result<StoredRequests, StoreError> {
    let transaction = stored(connection.transaction())?;
    let connection = &transaction;
    let limit = limit.min(MAX_RETAINED_REQUESTS_PER_THREAD);
    let total: i64 = stored(connection.query_row(
        "SELECT COUNT(*) FROM runtime_requests WHERE thread_id=?1",
        [thread_id],
        |row| row.get(0),
    ))?;
    let marked: bool = stored(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM runtime_request_marks
            WHERE thread_id=?1 AND (pruned>0 OR skipped>0))",
        [thread_id],
        |row| row.get(0),
    ))?;
    let mut selected = newest_candidates(connection, thread_id, Openness::Open, limit)?;
    let closed = newest_candidates(
        connection,
        thread_id,
        Openness::Closed,
        limit - selected.len(),
    )?;
    selected.extend(closed);
    let mut truncated = marked || usize::try_from(total).unwrap_or(usize::MAX) > selected.len();
    let mut unreadable = 0;
    let mut remaining = MAX_READ_REQUEST_BYTES;
    let mut requests = Vec::new();
    for candidate in selected {
        let Some(candidate) = candidate else {
            unreadable += 1;
            continue;
        };
        if candidate.bytes > remaining {
            truncated = true;
            continue;
        }
        let Some(request) = candidate.load(connection, thread_id)? else {
            unreadable += 1;
            continue;
        };
        remaining -= candidate.bytes;
        requests.push(request);
    }
    Ok(StoredRequests {
        requests: in_receiver_order(requests),
        truncated,
        unreadable,
    })
}
