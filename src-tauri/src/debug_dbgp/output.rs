use crate::debug_adapter::{DebugEventPayload, DebugOutputStream};

pub(super) fn plain(stream: DebugOutputStream, text: String) -> DebugEventPayload {
    DebugEventPayload::Output {
        stream,
        text,
        truncated: false,
    }
}
