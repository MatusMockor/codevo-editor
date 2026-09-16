use super::TurnState;
use crate::agent_questions::{
    AgentQuestion, AgentQuestionOption, AgentQuestionRequest, AgentQuestionStatus,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{atomic::Ordering, Arc};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Params {
    thread_id: String,
    turn_id: String,
    questions: Vec<Question>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Question {
    id: String,
    header: String,
    question: String,
    #[serde(default)]
    options: Option<Vec<OptionItem>>,
    #[serde(default)]
    is_secret: bool,
}
#[derive(Deserialize)]
struct OptionItem {
    label: String,
    description: String,
}

pub(super) fn register(state: &Arc<TurnState>, rpc_id: Value, params: Value) -> Result<(), String> {
    let params: Params =
        serde_json::from_value(params).map_err(|_| "Codex question is malformed.".to_string())?;
    if params.thread_id != state.thread_id
        || params.turn_id != state.turn_id
        || state.input_closed.load(Ordering::SeqCst)
    {
        return Err("Codex question does not belong to the active turn.".into());
    }
    if params.questions.iter().any(|q| q.is_secret) {
        return Err("Secret input questions are unsupported.".into());
    }
    let questions: Vec<_> = params
        .questions
        .into_iter()
        .map(|q| AgentQuestion {
            id: q.id,
            header: q.header,
            prompt: q.question,
            multiple: false,
            allow_custom: true,
            options: q
                .options
                .unwrap_or_default()
                .into_iter()
                .enumerate()
                .map(|(i, o)| AgentQuestionOption {
                    id: format!("option-{i}"),
                    label: o.label,
                    description: o.description,
                })
                .collect(),
        })
        .collect();
    let response_questions = questions.clone();
    let state_weak = Arc::downgrade(state);
    state.questions.register(
        AgentQuestionRequest {
            id: request_id(&rpc_id),
            task_id: String::new(),
            provider: "codex".into(),
            questions,
            status: AgentQuestionStatus::Pending,
            answers: None,
        },
        Arc::new(move |response| {
            let state = state_weak.upgrade().ok_or("Codex turn was released.")?;
            let _gate = state
                .question_gate
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.input_closed.load(Ordering::SeqCst) {
                return Err("Codex turn was released.".into());
            }
            let mut answers = serde_json::Map::new();
            for answer in &response.answers {
                let question = response_questions
                    .iter()
                    .find(|q| q.id == answer.question_id)
                    .ok_or("Unknown question.")?;
                let mut values: Vec<String> = answer
                    .option_ids
                    .iter()
                    .map(|id| {
                        question
                            .options
                            .iter()
                            .find(|o| &o.id == id)
                            .map(|o| o.label.clone())
                            .ok_or("Unknown option.")
                    })
                    .collect::<Result<_, _>>()?;
                if !answer.text.trim().is_empty() {
                    values.push(answer.text.clone());
                }
                answers.insert(answer.question_id.clone(), json!({"answers":values}));
            }
            state.port.answer_question(
                rpc_id.clone(),
                json!({"answers":answers}),
                &state.input_closed,
            )
        }),
    )
}

pub(super) fn request_id(id: &Value) -> String {
    format!(
        "codex-question-{:x}",
        Sha256::digest(id.to_string().as_bytes())
    )
}
