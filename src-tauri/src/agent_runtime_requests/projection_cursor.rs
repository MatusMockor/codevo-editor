use super::model::is_identifier;
use super::projection_overlay::Candidate;
use super::scopes::HistoryScope;

pub const MAX_PULL_PAGES: usize = 128;
pub const MAX_CURSOR_BYTES: usize = 256;
const CURSOR_VERSION: &str = "c2";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Phase {
    Open,
    Closed,
}

impl Phase {
    fn token(self) -> &'static str {
        match self {
            Self::Open => "o",
            Self::Closed => "c",
        }
    }

    fn parse(token: &str) -> Option<Self> {
        match token {
            "o" => Some(Self::Open),
            "c" => Some(Self::Closed),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Position {
    pub(super) page: usize,
    pub(super) phase: Phase,
    pub(super) turn: usize,
    pub(super) after: Option<(u64, String)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Continuation {
    pub(super) generation: String,
    pub(super) position: Position,
}

struct Hasher(u64);

impl Hasher {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    fn field(&mut self, field: &str) {
        for byte in field.bytes().chain([0]) {
            self.0 ^= u64::from(byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn finish(&self) -> String {
        format!("{:016x}", self.0)
    }
}

pub(super) fn binding(
    epoch: &str,
    scope: &HistoryScope,
    thread_id: &str,
    turn_ids: &[String],
) -> String {
    let mut hasher = Hasher::new();
    let fixed = [epoch, &scope.root_key, &scope.owner_id, thread_id];
    for field in fixed
        .into_iter()
        .chain(turn_ids.iter().map(String::as_str))
    {
        hasher.field(field);
    }
    hasher.finish()
}

pub(super) fn generation<'a>(turns: impl Iterator<Item = &'a [Candidate]>) -> String {
    let mut hasher = Hasher::new();
    for (index, listed) in turns.enumerate() {
        hasher.field(&index.to_string());
        for candidate in listed {
            hasher.field(&candidate.id);
            hasher.field(&candidate.order.to_string());
            hasher.field(["c", "o"][usize::from(candidate.open)]);
        }
    }
    hasher.finish()
}

impl Position {
    pub(super) fn start() -> Self {
        Self {
            page: 0,
            phase: Phase::Open,
            turn: 0,
            after: None,
        }
    }
}

impl Continuation {
    pub(super) fn encoded(&self, binding: &str) -> String {
        let position = &self.position;
        let (order, id) = match &position.after {
            Some((order, id)) => (order.to_string(), id.as_str()),
            None => ("-".to_string(), ""),
        };
        format!(
            "{CURSOR_VERSION}.{binding}.{}.{}.{}.{}.{order}.{id}",
            self.generation,
            position.page,
            position.phase.token(),
            position.turn
        )
    }

    pub(super) fn decoded(cursor: &str, binding: &str, turns: usize) -> Option<Self> {
        if cursor.len() > MAX_CURSOR_BYTES {
            return None;
        }
        let mut fields = cursor.splitn(8, '.');
        if fields.next()? != CURSOR_VERSION || fields.next()? != binding {
            return None;
        }
        let generation = fields.next()?.to_string();
        let page: usize = fields.next()?.parse().ok()?;
        let phase = Phase::parse(fields.next()?)?;
        let turn: usize = fields.next()?.parse().ok()?;
        let order = fields.next()?;
        let id = fields.next()?;
        if page == 0 || page >= MAX_PULL_PAGES || turn >= turns || generation.len() != 16 {
            return None;
        }
        let after = match (order, id) {
            ("-", "") => None,
            (order, id) if is_identifier(id) => Some((order.parse().ok()?, id.to_string())),
            _ => return None,
        };
        Some(Self {
            generation,
            position: Position {
                page,
                phase,
                turn,
                after,
            },
        })
    }
}
