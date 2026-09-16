use super::{CodexClippedText, ServerNotification};
pub(super) fn belongs_to_turn(
    notification: &ServerNotification,
    thread_id: &str,
    turn_id: &str,
) -> bool {
    let authority = match notification {
        ServerNotification::TurnStarted(payload) => {
            Some((payload.thread_id.as_str(), Some(payload.turn.id.as_str())))
        }
        ServerNotification::TurnCompleted(payload) => {
            Some((payload.thread_id.as_str(), Some(payload.turn.id.as_str())))
        }
        ServerNotification::ItemStarted(payload) | ServerNotification::ItemCompleted(payload) => {
            Some((payload.thread_id.as_str(), payload.turn_id.as_deref()))
        }
        ServerNotification::ThreadTokenUsageUpdated(payload) => {
            Some((payload.thread_id.as_str(), payload.turn_id.as_deref()))
        }
        ServerNotification::ThreadCompacted(payload) => {
            Some((payload.thread_id.as_str(), payload.turn_id.as_deref()))
        }
        ServerNotification::Error(payload) => payload
            .thread_id
            .as_deref()
            .map(|thread| (thread, payload.turn_id.as_deref())),
        _ => None,
    };
    !authority.is_some_and(|(thread, turn)| {
        thread == thread_id && turn.is_some_and(|turn| turn != turn_id)
    })
}

pub(super) fn bounded_error(reason: &str) -> CodexClippedText {
    let mut end = reason.len().min(4096);
    while !reason.is_char_boundary(end) {
        end -= 1;
    }
    CodexClippedText {
        text: reason[..end].to_string(),
        clipped: end != reason.len(),
    }
}
