use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, PoisonError};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentQuestionOption {
    pub id: String,
    pub label: String,
    pub description: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentQuestion {
    pub id: String,
    pub header: String,
    pub prompt: String,
    pub options: Vec<AgentQuestionOption>,
    pub multiple: bool,
    pub allow_custom: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentQuestionStatus {
    Pending,
    Answered,
    Cancelled,
    Expired,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentQuestionAnswerItem {
    pub question_id: String,
    pub option_ids: Vec<String>,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentQuestionResponse {
    pub answers: Vec<AgentQuestionAnswerItem>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentQuestionRequest {
    pub id: String,
    pub task_id: String,
    pub provider: String,
    pub questions: Vec<AgentQuestion>,
    pub status: AgentQuestionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<Vec<AgentQuestionAnswerItem>>,
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
}
fn text(value: &str, max: usize, empty: bool) -> bool {
    value.len() <= max && !value.contains('\0') && (empty || !value.trim().is_empty())
}
pub fn validate_request(request: &AgentQuestionRequest) -> Result<(), String> {
    if !id(&request.id)
        || !matches!(request.provider.as_str(), "codex" | "claudeCode")
        || request.questions.is_empty()
        || request.questions.len() > 4
    {
        return Err("Invalid agent question.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for q in &request.questions {
        if !id(&q.id)
            || !ids.insert(&q.id)
            || !text(&q.header, 128, true)
            || !text(&q.prompt, 8192, false)
            || q.options.len() > 12
            || (q.options.is_empty() && !q.allow_custom)
        {
            return Err("Invalid agent question.".into());
        }
        let mut options = std::collections::HashSet::new();
        for o in &q.options {
            if !id(&o.id)
                || !options.insert(&o.id)
                || !text(&o.label, 512, false)
                || !text(&o.description, 2048, true)
            {
                return Err("Invalid agent question option.".into());
            }
        }
    }
    match (&request.status, &request.answers) {
        (AgentQuestionStatus::Answered, Some(answers)) => validate_response(
            request,
            &AgentQuestionResponse {
                answers: answers.clone(),
            },
        )?,
        (AgentQuestionStatus::Answered, None) => {
            return Err("Answered question has no answers.".into())
        }
        (_, Some(_)) => return Err("Pending question contains answers.".into()),
        (_, None) => (),
    }
    Ok(())
}
pub fn validate_response(
    request: &AgentQuestionRequest,
    response: &AgentQuestionResponse,
) -> Result<(), String> {
    if response.answers.len() != request.questions.len() {
        return Err("Answer every question.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for a in &response.answers {
        let q = request
            .questions
            .iter()
            .find(|q| q.id == a.question_id)
            .ok_or("Unknown question.")?;
        if !ids.insert(&a.question_id)
            || !text(&a.text, 8192, true)
            || (!q.allow_custom && !a.text.is_empty())
            || (!q.multiple && a.option_ids.len() > 1)
            || a.option_ids.len() > 12
            || (a.option_ids.is_empty() && a.text.trim().is_empty())
        {
            return Err("Invalid question answer.".into());
        }
        let mut options = std::collections::HashSet::new();
        for option in &a.option_ids {
            if !options.insert(option) || !q.options.iter().any(|o| &o.id == option) {
                return Err("Unknown answer option.".into());
            }
        }
    }
    Ok(())
}
pub type AgentQuestionResponder =
    Arc<dyn Fn(&AgentQuestionResponse) -> Result<(), String> + Send + Sync>;
struct Entry {
    request: AgentQuestionRequest,
    responder: Option<AgentQuestionResponder>,
    submitting: bool,
}
#[derive(Default)]
struct State {
    entries: Vec<Entry>,
    closed: bool,
    failure: Option<String>,
}
#[derive(Default)]
pub struct AgentQuestionSession {
    state: Mutex<State>,
}
impl AgentQuestionSession {
    pub fn has_pending(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entries
            .iter()
            .any(|entry| entry.request.status == AgentQuestionStatus::Pending)
    }
    pub fn failure(&self) -> Option<String> {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .failure
            .clone()
    }
    pub fn fail(&self, reason: &str) {
        self.close();
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.failure.is_none() {
            state.failure = Some(reason.chars().take(1024).collect());
        }
    }
    pub fn new() -> Self {
        Self::default()
    }
    pub fn register(
        &self,
        request: AgentQuestionRequest,
        responder: AgentQuestionResponder,
    ) -> Result<(), String> {
        validate_request(&request)?;
        if request.status != AgentQuestionStatus::Pending {
            return Err("Only pending questions may be registered.".into());
        }
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.closed
            || state.entries.iter().any(|e| e.request.id == request.id)
            || state
                .entries
                .iter()
                .filter(|e| e.request.status == AgentQuestionStatus::Pending)
                .count()
                >= 4
        {
            return Err("Question session unavailable.".into());
        }
        if state.entries.len() >= 32 {
            let i = state
                .entries
                .iter()
                .position(|e| e.request.status != AgentQuestionStatus::Pending)
                .ok_or("Question limit reached.")?;
            state.entries.remove(i);
        }
        state.entries.push(Entry {
            request,
            responder: Some(responder),
            submitting: false,
        });
        Ok(())
    }
    pub fn list(&self, task_id: &str) -> Vec<AgentQuestionRequest> {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entries
            .iter()
            .map(|e| {
                let mut r = e.request.clone();
                r.task_id = task_id.into();
                r
            })
            .collect()
    }
    pub fn expire(&self, request_id: &str) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(entry) = state
            .entries
            .iter_mut()
            .find(|e| e.request.id == request_id)
        {
            if entry.request.status == AgentQuestionStatus::Pending && !entry.submitting {
                entry.request.status = AgentQuestionStatus::Expired;
                entry.responder = None;
            }
        }
    }
    pub fn cancel(&self, request_id: &str) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(entry) = state
            .entries
            .iter_mut()
            .find(|e| e.request.id == request_id)
        {
            if entry.request.status == AgentQuestionStatus::Pending {
                entry.request.status = AgentQuestionStatus::Cancelled;
                entry.responder = None;
            }
        }
    }
    pub fn finish(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.closed = true;
        for entry in &mut state.entries {
            if entry.request.status == AgentQuestionStatus::Pending && !entry.submitting {
                entry.request.status = AgentQuestionStatus::Expired;
                entry.responder = None;
            }
        }
    }
    pub fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.closed = true;
        for entry in &mut state.entries {
            if entry.request.status == AgentQuestionStatus::Pending {
                entry.request.status = AgentQuestionStatus::Expired;
                entry.responder = None;
            }
        }
    }
    pub fn answer(
        &self,
        task_id: &str,
        request_id: &str,
        response: AgentQuestionResponse,
    ) -> Result<AgentQuestionRequest, String> {
        let responder = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            if state.closed {
                return Err("Question is no longer pending.".into());
            }
            let entry = state
                .entries
                .iter_mut()
                .find(|e| e.request.id == request_id)
                .ok_or("Unknown question.")?;
            validate_response(&entry.request, &response)?;
            if entry.request.status == AgentQuestionStatus::Answered
                && entry.request.answers.as_ref() == Some(&response.answers)
            {
                let mut r = entry.request.clone();
                r.task_id = task_id.into();
                return Ok(r);
            }
            if entry.request.status != AgentQuestionStatus::Pending || entry.submitting {
                return Err("Question is no longer pending.".into());
            }
            entry.submitting = true;
            entry
                .responder
                .take()
                .ok_or("Question is no longer pending.")?
        };
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| responder(&response)))
                .unwrap_or_else(|_| Err("Question response failed.".into()));
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = state
            .entries
            .iter_mut()
            .find(|e| e.request.id == request_id)
            .ok_or("Question expired.")?;
        if entry.request.status != AgentQuestionStatus::Pending {
            return Err("Question expired while sending answer.".into());
        }
        entry.submitting = false;
        match result {
            Ok(()) => {
                entry.request.status = AgentQuestionStatus::Answered;
                entry.request.answers = Some(response.answers);
                let mut r = entry.request.clone();
                r.task_id = task_id.into();
                Ok(r)
            }
            Err(error) => {
                entry.request.status = AgentQuestionStatus::Expired;
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> AgentQuestionRequest {
        serde_json::from_value(serde_json::json!({"id":"request-1","taskId":"","provider":"codex","questions":[{"id":"q","header":"Choice","prompt":"Which?","options":[{"id":"o","label":"One","description":""}],"multiple":false,"allowCustom":true}],"status":"pending"})).unwrap()
    }
    fn response() -> AgentQuestionResponse {
        AgentQuestionResponse {
            answers: vec![AgentQuestionAnswerItem {
                question_id: "q".into(),
                option_ids: vec!["o".into()],
                text: String::new(),
            }],
        }
    }
    #[test]
    fn answers_once_and_replays_identical_answer() {
        let s = AgentQuestionSession::new();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let c = count.clone();
        s.register(
            request(),
            Arc::new(move |_| {
                c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            }),
        )
        .unwrap();
        assert_eq!(
            s.answer("task", "request-1", response()).unwrap().task_id,
            "task"
        );
        s.answer("task", "request-1", response()).unwrap();
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
    #[test]
    fn rejects_unknown_duplicate_and_empty_answers() {
        let r = request();
        let mut a = response();
        a.answers[0].option_ids = vec!["unknown".into()];
        assert!(validate_response(&r, &a).is_err());
        a.answers[0].option_ids = vec!["o".into(), "o".into()];
        assert!(validate_response(&r, &a).is_err());
        a.answers[0].option_ids.clear();
        assert!(validate_response(&r, &a).is_err());
    }
    #[test]
    fn close_expires_question_without_invoking_callback() {
        let s = AgentQuestionSession::new();
        s.register(request(), Arc::new(|_| panic!("expired responder")))
            .unwrap();
        s.close();
        assert_eq!(s.list("task")[0].status, AgentQuestionStatus::Expired);
        assert!(s.answer("task", "request-1", response()).is_err());
    }
    #[test]
    fn stop_during_response_never_publishes_answered() {
        let s = Arc::new(AgentQuestionSession::new());
        let weak = Arc::downgrade(&s);
        s.register(
            request(),
            Arc::new(move |_| {
                weak.upgrade().unwrap().close();
                Ok(())
            }),
        )
        .unwrap();
        assert!(s.answer("task", "request-1", response()).is_err());
        assert_eq!(s.list("task")[0].status, AgentQuestionStatus::Expired);
    }
    #[test]
    fn normal_completion_during_response_preserves_success() {
        let s = Arc::new(AgentQuestionSession::new());
        let weak = Arc::downgrade(&s);
        s.register(
            request(),
            Arc::new(move |_| {
                weak.upgrade().unwrap().finish();
                Ok(())
            }),
        )
        .unwrap();
        assert_eq!(
            s.answer("task", "request-1", response()).unwrap().status,
            AgentQuestionStatus::Answered
        );
    }
    #[test]
    fn limits_pending_requests_and_rejects_duplicate_ids() {
        let s = AgentQuestionSession::new();
        for i in 0..4 {
            let mut r = request();
            r.id = format!("r{i}");
            s.register(r, Arc::new(|_| Ok(()))).unwrap();
        }
        assert!(s.register(request(), Arc::new(|_| Ok(()))).is_err());
        assert_eq!(s.list("t").len(), 4);
    }
}
