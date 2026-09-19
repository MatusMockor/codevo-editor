use rusqlite::ffi::ErrorCode;

pub(crate) const MAX_SEQUENCE_GAP_HINT: i64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentTurnLogError {
    SupersededWriter,
    SequenceGap(Option<i64>),
    Sealed,
    OwnerMismatch,
    BudgetExhausted,
    DiskFull,
    Foreign,
    Unreadable,
    Corrupt,
    Busy,
}

impl AgentTurnLogError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::SupersededWriter => "supersededWriter",
            Self::SequenceGap(_) => "sequenceGap",
            Self::Sealed => "sealed",
            Self::OwnerMismatch => "ownerMismatch",
            Self::BudgetExhausted => "budgetExhausted",
            Self::DiskFull => "diskFull",
            Self::Foreign => "foreign",
            Self::Unreadable | Self::Corrupt => "unreadable",
            Self::Busy => "busy",
        }
    }

    pub(crate) fn message(self) -> String {
        let Self::SequenceGap(Some(next_seq)) = self else {
            return self.code().to_string();
        };
        if !(super::wire::AGENT_TURN_LOG_SEQ_BASE..=MAX_SEQUENCE_GAP_HINT).contains(&next_seq) {
            return self.code().to_string();
        }
        format!("sequenceGap:{next_seq}")
    }

    pub(crate) fn retains_connection(self) -> bool {
        !matches!(self, Self::Foreign | Self::Unreadable | Self::Corrupt)
    }
}

pub(crate) fn sequence_gap() -> AgentTurnLogError {
    AgentTurnLogError::SequenceGap(None)
}

pub(crate) type AgentTurnLogResult<T> = Result<T, AgentTurnLogError>;

const SQLITE_FULL: i32 = 13;

pub(crate) fn classify_sqlite_error(error: &rusqlite::Error) -> AgentTurnLogError {
    let rusqlite::Error::SqliteFailure(failure, _) = error else {
        return AgentTurnLogError::Unreadable;
    };
    if failure.code == ErrorCode::DiskFull || failure.extended_code == SQLITE_FULL {
        return AgentTurnLogError::DiskFull;
    }
    if matches!(
        failure.code,
        ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked
    ) {
        return AgentTurnLogError::Busy;
    }
    if matches!(
        failure.code,
        ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase
    ) {
        return AgentTurnLogError::Corrupt;
    }
    AgentTurnLogError::Unreadable
}

pub(crate) fn sqlite<T>(outcome: rusqlite::Result<T>) -> AgentTurnLogResult<T> {
    outcome.map_err(|error| classify_sqlite_error(&error))
}
