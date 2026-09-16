//! Claude's documented SDK control channel, independently of transcript retention.
use super::agent_task_input::RetainedChildStdin;
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionSession};
use serde_json::{json, Value};
use std::{
    io::{self, Read},
    sync::Arc,
    time::{Duration, Instant},
};

const MAX_CONTROL_LINE_BYTES: usize = 256 * 1024;

pub struct ClaudeQuestionReader<R> {
    reader: R,
    questions: Arc<AgentQuestionSession>,
    input: RetainedChildStdin,
    line: Vec<u8>,
    dropping: bool,
}

impl<R: Read> ClaudeQuestionReader<R> {
    pub fn new(reader: R, questions: Arc<AgentQuestionSession>, input: RetainedChildStdin) -> Self {
        Self {
            reader,
            questions,
            input,
            line: Vec::new(),
            dropping: false,
        }
    }

    fn observe(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if byte == b'\n' {
                if !self.dropping {
                    self.handle_line();
                }
                self.line.clear();
                self.dropping = false;
            } else if !self.dropping {
                if self.line.len() == MAX_CONTROL_LINE_BYTES {
                    if is_control_prefix(&self.line) {
                        self.questions
                            .fail("The provider sent an oversized interactive request.");
                    }
                    self.line.clear();
                    self.dropping = true;
                } else {
                    self.line.push(byte);
                }
            }
        }
    }

    fn handle_line(&self) {
        let Ok(value) = serde_json::from_slice::<Value>(&self.line) else {
            if is_control_prefix(&self.line) {
                self.questions
                    .fail("The provider sent a malformed interactive request.");
            }
            return;
        };
        if value.get("type").and_then(Value::as_str) == Some("control_cancel_request") {
            if let Some(id) = value.get("request_id").and_then(Value::as_str) {
                self.questions.cancel(&public_request_id(id));
            }
            return;
        }
        if value.get("type").and_then(Value::as_str) != Some("control_request") {
            return;
        }
        let Some(request_id) = value
            .get("request_id")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
        else {
            self.questions
                .fail("The provider sent an interactive request without a valid identifier.");
            return;
        };
        if self
            .questions
            .list("")
            .iter()
            .any(|question| question.id == public_request_id(request_id))
        {
            return;
        }
        let Some(request) = value.get("request") else {
            let _ = write_envelope(
                &self.input,
                json!({"subtype":"error","request_id":request_id,"error":"Missing control request payload."}),
            );
            return;
        };
        if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
            let _ = write_envelope(
                &self.input,
                json!({"subtype":"error", "request_id":request_id, "error":"This editor does not support this control request."}),
            );
            return;
        }
        if request.get("tool_name").and_then(Value::as_str) != Some("AskUserQuestion") {
            self.deny(
                request_id,
                "This tool requires a permission this editor cannot grant interactively.",
            );
            return;
        }
        let Some(input) = request.get("input") else {
            self.deny(request_id, "Missing question input.");
            return;
        };
        let Ok(question) = parse_question(request_id, input) else {
            self.deny(request_id, "Unsupported or invalid question.");
            return;
        };
        let retained = Arc::clone(&self.input);
        let request_id_owned = request_id.to_string();
        let original = input.clone();
        let tool_use_id = request.get("tool_use_id").cloned();
        let responder = Arc::new(
            move |response: &crate::agent_questions::AgentQuestionResponse| {
                let encoded = serde_json::to_value(response)
                    .map_err(|_| "Unable to encode answer.".to_string())?;
                let updated = answered_input(&original, &encoded)?;
                let mut result = json!({"behavior":"allow", "updatedInput":updated});
                if let Some(tool_use_id) = &tool_use_id {
                    result["toolUseID"] = tool_use_id.clone();
                }
                write_response(&retained, &request_id_owned, result)
            },
        );
        if self.questions.register(question, responder).is_err() {
            self.deny(
                request_id,
                "The question could not be registered or is no longer active.",
            );
        }
    }

    fn deny(&self, request_id: &str, message: &str) {
        let _ = write_response(
            &self.input,
            request_id,
            json!({"behavior":"deny", "message":message}),
        );
    }
}

impl<R: Read> Read for ClaudeQuestionReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.reader.read(buffer)?;
        if count == 0 {
            self.questions.finish();
        } else {
            self.observe(&buffer[..count]);
        }
        Ok(count)
    }
}

// The CLI emits `type` before its payload. Inspect that top-level field even
// when the following payload is incomplete, without retaining a huge JSON value.
fn is_control_prefix(bytes: &[u8]) -> bool {
    struct EnvelopeType<'a>(&'a mut bool);
    impl<'de> serde::de::Visitor<'de> for EnvelopeType<'_> {
        type Value = ();
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a control envelope")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<(), M::Error> {
            while let Some(key) = map.next_key::<String>()? {
                if key == "type" {
                    let kind = map.next_value::<String>()?;
                    *self.0 = matches!(kind.as_str(), "control_request" | "control_cancel_request");
                    return Ok(());
                }
                map.next_value::<serde::de::IgnoredAny>()?;
            }
            Ok(())
        }
    }
    let mut control = false;
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let _ = serde::Deserializer::deserialize_map(&mut deserializer, EnvelopeType(&mut control));
    control
}

fn public_request_id(request_id: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("claude-{:x}", Sha256::digest(request_id.as_bytes()))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .enumerate()
            .all(|(index, b)| b.is_ascii_alphanumeric() || (index > 0 && b"_.:-".contains(&b)))
}

fn parse_question(request_id: &str, input: &Value) -> Result<AgentQuestionRequest, String> {
    let items = input
        .get("questions")
        .and_then(Value::as_array)
        .ok_or("Missing questions")?;
    if items.is_empty() || items.len() > 4 {
        return Err("Invalid question count".into());
    }
    let mut questions = Vec::new();
    let mut prompts = std::collections::HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let prompt = item
            .get("question")
            .and_then(Value::as_str)
            .ok_or("Missing question text")?;
        if !prompts.insert(prompt) {
            return Err("Duplicate question text".into());
        }
        let options = item
            .get("options")
            .and_then(Value::as_array)
            .ok_or("Missing options")?;
        if options.len() > 12 {
            return Err("Too many options".into());
        }
        let options: Vec<Value> = options
            .iter()
            .enumerate()
            .map(|(i, option)| {
                json!({
                    "id":format!("option-{i}"), "label":option.get("label"),
                    "description":option.get("description").cloned().unwrap_or(json!(""))
                })
            })
            .collect();
        questions.push(json!({"id":format!("question-{index}"), "header":item.get("header").cloned().unwrap_or(json!("")),
            "prompt":item.get("question"),"options":options,"multiple":item.get("multiSelect").cloned().unwrap_or(json!(false)),"allowCustom":true}));
    }
    serde_json::from_value(json!({"id":public_request_id(request_id),"taskId":"","provider":"claudeCode","questions":questions,"status":"pending"}))
        .map_err(|_| "Invalid question payload".into())
}

fn answered_input(original: &Value, response: &Value) -> Result<Value, String> {
    let questions = original
        .get("questions")
        .and_then(Value::as_array)
        .ok_or("Missing questions")?;
    let answers = response
        .get("answers")
        .and_then(Value::as_array)
        .ok_or("Missing answers")?;
    let mut mapping = serde_json::Map::new();
    for (i, question) in questions.iter().enumerate() {
        let id = format!("question-{i}");
        let answer = answers
            .iter()
            .find(|answer| answer.get("questionId").and_then(Value::as_str) == Some(&id))
            .ok_or("Missing answer")?;
        let options = question
            .get("options")
            .and_then(Value::as_array)
            .ok_or("Missing options")?;
        let mut selected = Vec::new();
        for id in answer
            .get("optionIds")
            .and_then(Value::as_array)
            .ok_or("Missing selections")?
        {
            let index = id
                .as_str()
                .and_then(|s| s.strip_prefix("option-"))
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or("Invalid option")?;
            selected.push(
                options
                    .get(index)
                    .and_then(|v| v.get("label"))
                    .and_then(Value::as_str)
                    .ok_or("Unknown option")?
                    .to_string(),
            );
        }
        let text = answer
            .get("text")
            .and_then(Value::as_str)
            .ok_or("Missing answer text")?;
        if !text.is_empty() {
            selected.push(text.to_string());
        }
        let prompt = question
            .get("question")
            .and_then(Value::as_str)
            .ok_or("Missing question")?;
        if mapping
            .insert(prompt.to_string(), json!(selected.join(", ")))
            .is_some()
        {
            return Err("Duplicate question prompt".into());
        }
    }
    let mut updated = original.clone();
    updated["answers"] = Value::Object(mapping);
    Ok(updated)
}

fn write_response(
    input: &RetainedChildStdin,
    request_id: &str,
    response: Value,
) -> Result<(), String> {
    write_envelope(
        input,
        json!({"subtype":"success","request_id":request_id,"response":response}),
    )
}

fn write_envelope(input: &RetainedChildStdin, response: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&json!({"type":"control_response","response":response}))
        .map_err(|_| "Unable to encode answer".to_string())?;
    bytes.push(b'\n');
    input
        .write_frame(&bytes, Instant::now() + Duration::from_secs(5))
        .map_err(|_| "Question response could not reach the active process.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn fragmented_control_request_registers_once_and_provider_cancel_expires_it() {
        let mut child = std::process::Command::new("/usr/bin/true")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let input = Arc::new(super::super::agent_task_input::RetainedAgentStdin::new(
            child.stdin.take().unwrap(),
        ));
        let session = Arc::new(AgentQuestionSession::new());
        let mut reader = ClaudeQuestionReader::new(io::empty(), Arc::clone(&session), input);
        let request = json!({"type":"control_request","request_id":"request-1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Where?","options":[{"label":"Linux"}]}]}}});
        let bytes = format!("{request}\n");
        for chunk in bytes.as_bytes().chunks(3) {
            reader.observe(chunk);
        }
        reader.observe(bytes.as_bytes());
        assert_eq!(session.list("task-1").len(), 1);
        assert_eq!(
            session.list("task-1")[0].status,
            crate::agent_questions::AgentQuestionStatus::Pending
        );
        reader.observe(b"{\"type\":\"control_cancel_request\",\"request_id\":\"request-1\"}\n");
        assert_eq!(
            session.list("task-1")[0].status,
            crate::agent_questions::AgentQuestionStatus::Cancelled
        );
        child.wait().unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn oversized_line_is_bounded_and_next_question_still_parses() {
        let mut child = std::process::Command::new("/usr/bin/true")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let input = Arc::new(super::super::agent_task_input::RetainedAgentStdin::new(
            child.stdin.take().unwrap(),
        ));
        let session = Arc::new(AgentQuestionSession::new());
        let mut reader = ClaudeQuestionReader::new(io::empty(), Arc::clone(&session), input);
        reader.observe(&vec![b'x'; MAX_CONTROL_LINE_BYTES * 2]);
        assert!(reader.line.len() <= MAX_CONTROL_LINE_BYTES);
        reader.observe(b"\n");
        let request = json!({"type":"control_request","request_id":"request-2","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Next?","options":[]}]}}});
        reader.observe(format!("{request}\n").as_bytes());
        assert_eq!(session.list("task-1").len(), 1);
        child.wait().unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn oversized_question_fails_the_process_instead_of_hiding_a_waiter() {
        let mut child = std::process::Command::new("/usr/bin/true")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let input = Arc::new(super::super::agent_task_input::RetainedAgentStdin::new(
            child.stdin.take().unwrap(),
        ));
        let session = Arc::new(AgentQuestionSession::new());
        let mut reader = ClaudeQuestionReader::new(io::empty(), Arc::clone(&session), input);
        reader.observe(b"{\"type\":\"control_request\",\"request\":\"");
        reader.observe(&vec![b'x'; MAX_CONTROL_LINE_BYTES]);
        assert!(session.failure().unwrap().contains("oversized"));
        assert!(session.list("task-1").is_empty());
        child.wait().unwrap();
    }
    #[test]
    fn control_prefix_is_top_level_and_works_before_payload_completes() {
        assert!(is_control_prefix(
            b"{\"type\":\"control_request\",\"request\":"
        ));
        assert!(!is_control_prefix(
            b"{\"type\":\"assistant\",\"message\":\"control_request"
        ));
        assert!(!is_control_prefix(
            b"{\"nested\":{\"type\":\"control_request\"},\"type\":\"assistant\"}"
        ));
    }
    #[test]
    fn answer_preserves_input_and_maps_options_and_custom_text() {
        let original = json!({"questions":[{"question":"Where?","options":[{"label":"Local"},{"label":"Remote"}]}],"metadata":{"unchanged":true}});
        let response = json!({"answers":[{"questionId":"question-0","optionIds":["option-1"],"text":"Use Linux"}]});
        let updated = answered_input(&original, &response).unwrap();
        assert_eq!(updated["answers"]["Where?"], "Remote, Use Linux");
        assert_eq!(updated["metadata"], original["metadata"]);
        assert!(original.get("answers").is_none());
    }
    #[test]
    fn duplicate_question_text_cannot_create_ambiguous_provider_answer() {
        assert!(parse_question(
            "request-1",
            &json!({"questions":[
                {"question":"Same?","options":[]}, {"question":"Same?","options":[]}
            ]})
        )
        .is_err());
    }
    #[test]
    fn unknown_option_and_missing_answers_fail_closed() {
        let original = json!({"questions":[{"question":"Where?","options":[{"label":"Local"}]}]});
        assert!(answered_input(&original, &json!({"answers":[]})).is_err());
        assert!(answered_input(
            &original,
            &json!({"answers":[{"questionId":"question-0","optionIds":["option-2"],"text":""}]})
        )
        .is_err());
    }
    #[test]
    fn parses_provider_shape_into_canonical_contract() {
        let request = parse_question("request-1", &json!({"questions":[{"question":"Where?","header":"Target","options":[{"label":"Local","description":"This PC"}],"multiSelect":false}]})).unwrap();
        let value = serde_json::to_value(request).unwrap();
        assert_eq!(value["questions"][0]["id"], "question-0");
        assert_eq!(value["questions"][0]["allowCustom"], true);
    }
}
