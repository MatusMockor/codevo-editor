use std::{fmt, process::ChildStdin, time::Instant};

pub(super) trait InteractiveProbe: fmt::Debug + Send + Sync {
    fn observe(&self, bytes: &[u8]);

    fn advance(&self, stdin: Option<&mut ChildStdin>, now: Instant) -> Result<bool, String>;

    fn is_complete(&self) -> bool;
}
