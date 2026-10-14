use super::{
    interactions::{Exchange, InteractionError, InteractionRunnerPort},
    interactions_wire::WireError,
    types::uuid,
};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, PoisonError},
    time::Instant,
};

pub(super) const MAX_KNOWN_TASKS: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Membership {
    Member,
    Foreign,
}

struct Known {
    max_tasks: usize,
    clock: u64,
    tasks: HashMap<String, (String, u64)>,
}

pub(in crate::remote_runner) struct ConversationIndex(Mutex<Known>);

impl Default for ConversationIndex {
    fn default() -> Self {
        Self::with_limit(MAX_KNOWN_TASKS)
    }
}

impl ConversationIndex {
    pub(super) fn with_limit(max_tasks: usize) -> Self {
        Self(Mutex::new(Known {
            max_tasks,
            clock: 0,
            tasks: HashMap::new(),
        }))
    }

    fn locked(&self) -> MutexGuard<'_, Known> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn conversation(&self, task: &str) -> Option<String> {
        let mut known = self.locked();
        known.clock += 1;
        let touched = known.clock;
        let entry = known.tasks.get_mut(task)?;
        entry.1 = touched;
        Some(entry.0.clone())
    }

    pub(super) fn remember(&self, task: &str, conversation: String) {
        let mut known = self.locked();
        known.clock += 1;
        let touched = known.clock;
        known
            .tasks
            .insert(task.to_string(), (conversation, touched));
        while known.tasks.len() > known.max_tasks {
            let oldest = known
                .tasks
                .iter()
                .min_by_key(|(_, (_, touched))| *touched)
                .map(|(task, _)| task.clone());
            let Some(task) = oldest else {
                return;
            };
            known.tasks.remove(&task);
        }
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.locked().tasks.len()
    }
}

pub(super) fn conversation_of(record: &Value, task: &str) -> Result<String, WireError> {
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .ok_or(WireError::Malformed)?;
    if id != task {
        return Err(WireError::ForeignTask);
    }
    match record.get("conversationId") {
        None => Ok(task.to_string()),
        Some(Value::String(conversation)) if uuid(conversation).is_ok() => Ok(conversation.clone()),
        Some(_) => Err(WireError::Malformed),
    }
}

pub(super) fn membership<P: InteractionRunnerPort>(
    port: &P,
    runner: &str,
    task: &str,
    thread: &str,
    now: Instant,
    deadline: Option<Instant>,
) -> Result<Membership, InteractionError> {
    let index = port.ledger().conversations();
    let conversation = match index.conversation(task) {
        Some(conversation) => conversation,
        None => {
            let record = Exchange::open(port, runner, task, now)?
                .until(deadline)
                .task_record()?;
            let conversation = conversation_of(&record, task)?;
            index.remember(task, conversation.clone());
            conversation
        }
    };
    if conversation != thread {
        return Ok(Membership::Foreign);
    }
    Ok(Membership::Member)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TASK: &str = "8c0d1f5e-2a3b-4c4d-9e5f-6a7b8c9d0e1f";
    const CONVERSATION: &str = "5f0c2a9e-7b1d-4c3e-8a6f-0d1e2f3a4b5c";

    #[test]
    fn task_record_names_its_conversation_or_stands_for_itself() {
        let record = json!({"id": TASK, "conversationId": CONVERSATION, "parts": []});
        assert_eq!(conversation_of(&record, TASK), Ok(CONVERSATION.to_string()));
        let own = json!({"id": TASK, "status": "completed"});
        assert_eq!(conversation_of(&own, TASK), Ok(TASK.to_string()));
        for (record, expected) in [
            (json!({"id": CONVERSATION}), WireError::ForeignTask),
            (
                json!({"conversationId": CONVERSATION}),
                WireError::Malformed,
            ),
            (
                json!({"id": TASK, "conversationId": null}),
                WireError::Malformed,
            ),
            (
                json!({"id": TASK, "conversationId": "thread-1"}),
                WireError::Malformed,
            ),
            (
                json!({"id": TASK, "conversationId": CONVERSATION.to_uppercase()}),
                WireError::Malformed,
            ),
            (json!([]), WireError::Malformed),
        ] {
            assert_eq!(conversation_of(&record, TASK), Err(expected), "{record}");
        }
    }

    #[test]
    fn index_is_bounded_and_evicts_the_least_recently_used_task() {
        let index = ConversationIndex::with_limit(2);
        index.remember("a", "x".into());
        index.remember("b", "y".into());
        assert_eq!(index.conversation("a").as_deref(), Some("x"));
        index.remember("c", "z".into());
        assert_eq!(index.len(), 2);
        assert_eq!(index.conversation("b"), None);
        assert_eq!(index.conversation("a").as_deref(), Some("x"));
        assert_eq!(index.conversation("c").as_deref(), Some("z"));
        assert_eq!(MAX_KNOWN_TASKS, 256);
    }
}
