use super::model::{RequestResolution, RuntimeRequest};
use super::observed::ObservedTurn;
use super::scopes::HistoryScope;
use std::fmt;
use std::time::Instant;

pub use super::limits::{MAX_REQUEST_BODY_BYTES, MAX_REQUEST_OUTCOME_BYTES};

pub const MAX_REQUESTS_PER_TURN: usize = 512;
pub const MAX_REQUESTS_PER_THREAD: usize = 4096;
pub const ORPHAN_REQUEST_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const MAX_READ_REQUEST_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_JOURNALED_ROOTS: usize = 256;

const _: () = assert!(MAX_REQUEST_BODY_BYTES + MAX_REQUEST_OUTCOME_BYTES <= MAX_READ_REQUEST_BYTES);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TurnKey {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnObservation {
    pub key: TurnKey,
    pub incarnation: u64,
    pub first_observed_at_epoch_ms: u64,
    pub observed_at_epoch_ms: u64,
    pub turn: ObservedTurn,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ApplyReport {
    pub transitions: u64,
    pub skipped: u64,
    pub pruned: u64,
    pub lost_answers: u64,
    pub tombstoned: bool,
    pub stale: bool,
    pub superseded: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnswerIntent {
    pub key: TurnKey,
    pub incarnation: u64,
    pub request_id: String,
    pub resolution: RequestResolution,
    pub version: u64,
    pub at_epoch_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentReceipt {
    Recorded,
    RecordedWithoutAnswer,
    AlreadyAnswered,
    ThreadDeleted,
    NotJournaled,
    Refused,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentSettlement {
    Reverted,
    DeliveryFailed,
    Unconfirmed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentSettle {
    pub key: TurnKey,
    pub incarnation: u64,
    pub request_id: String,
    pub intent_version: u64,
    pub settlement: IntentSettlement,
    pub version: u64,
    pub at_epoch_ms: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecoveryReport {
    pub expired: u64,
    pub unconfirmed: u64,
    pub purged: u64,
    pub swept: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RootClaim {
    Acquired(RecoveryReport),
    AlreadyOwned,
    HeldByAnotherInstance,
}

impl RootClaim {
    pub fn is_owned(self) -> bool {
        !matches!(self, Self::HeldByAnotherInstance)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredRequests {
    pub requests: Vec<RuntimeRequest>,
    pub truncated: bool,
    pub unreadable: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreErrorKind {
    Busy,
    Full,
    DeadlineExceeded,
    HeldByAnotherInstance,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoreError {
    pub kind: StoreErrorKind,
    pub detail: String,
}

impl StoreError {
    pub fn new(kind: StoreErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Agent runtime request journal failed: {}",
            self.detail
        )
    }
}

impl std::error::Error for StoreError {}

pub trait RuntimeRequestStore: Send + Sync {
    fn claim_root(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        now_epoch_ms: u64,
    ) -> Result<RootClaim, StoreError>;

    fn apply_snapshot(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        observation: &TurnObservation,
    ) -> Result<ApplyReport, StoreError>;

    fn record_intent(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        intent: &AnswerIntent,
        deadline: Instant,
    ) -> Result<IntentReceipt, StoreError>;

    fn settle_intent(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        settle: &IntentSettle,
        deadline: Instant,
    ) -> Result<bool, StoreError>;

    fn read(
        &self,
        scope: &HistoryScope,
        thread_id: &str,
        limit: usize,
    ) -> Result<StoredRequests, StoreError>;

    fn retain_turn_states(
        &self,
        scope: &HistoryScope,
        run_id: &str,
        known_turns: &[TurnKey],
    ) -> Result<u64, StoreError>;
}
