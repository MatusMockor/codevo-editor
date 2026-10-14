use crate::agent_questions::{
    approvals::{
        AgentApprovalDecision, AgentApprovalFact, MAX_AGENT_APPROVAL_DETAIL_BYTES,
        MAX_AGENT_APPROVAL_FACTS, MAX_AGENT_APPROVAL_FACT_LABEL_BYTES,
        MAX_AGENT_APPROVAL_FACT_VALUE_BYTES, MAX_AGENT_APPROVAL_TITLE_BYTES,
    },
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionOption,
};
use serde::Serialize;
use std::collections::HashSet;

pub(super) const MAX_REQUEST_QUESTIONS: usize = 4;
const MAX_ID_BYTES: usize = 128;
const MAX_OPTIONS: usize = 12;
const MAX_HEADER_BYTES: usize = 128;
const MAX_TEXT_BYTES: usize = 8192;
const MAX_LABEL_BYTES: usize = 512;
const MAX_DESCRIPTION_BYTES: usize = 2048;

struct ByteBudget(usize);

impl std::io::Write for ByteBudget {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self
            .0
            .checked_sub(bytes.len())
            .ok_or(std::io::ErrorKind::Other)?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(super) fn within_budget(value: &impl Serialize, max_bytes: usize) -> bool {
    serde_json::to_writer(ByteBudget(max_bytes), value).is_ok()
}

fn ecmascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{9}'..='\u{D}'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn blank(value: &str) -> bool {
    value.chars().all(ecmascript_whitespace)
}

fn text(value: &str, max_bytes: usize) -> bool {
    value.len() <= max_bytes && !value.contains('\0')
}

fn visible_text(value: &str, max_bytes: usize) -> bool {
    text(value, max_bytes) && !blank(value)
}

pub(super) fn identifier(value: &str) -> bool {
    value.len() <= MAX_ID_BYTES
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

pub(super) fn provider(value: &str) -> bool {
    matches!(value, "codex" | "claudeCode")
}

fn unique<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    values.all(|value| seen.insert(value))
}

fn option(option: &AgentQuestionOption) -> bool {
    identifier(&option.id)
        && visible_text(&option.label, MAX_LABEL_BYTES)
        && text(&option.description, MAX_DESCRIPTION_BYTES)
}

fn question(question: &AgentQuestion) -> bool {
    identifier(&question.id)
        && text(&question.header, MAX_HEADER_BYTES)
        && visible_text(&question.prompt, MAX_TEXT_BYTES)
        && question.options.len() <= MAX_OPTIONS
        && (question.allow_custom || !question.options.is_empty())
        && question.options.iter().all(option)
        && unique(question.options.iter().map(|option| option.id.as_str()))
}

pub(super) fn questions(questions: &[AgentQuestion]) -> bool {
    (1..=MAX_REQUEST_QUESTIONS).contains(&questions.len())
        && questions.iter().all(question)
        && unique(questions.iter().map(|question| question.id.as_str()))
}

pub(super) fn bounded_answer(answer: &AgentQuestionAnswerItem) -> bool {
    answer.question_id.len() <= MAX_ID_BYTES
        && answer.option_ids.len() <= MAX_OPTIONS
        && answer
            .option_ids
            .iter()
            .all(|option| option.len() <= MAX_ID_BYTES)
        && answer.text.len() <= MAX_TEXT_BYTES
}

fn answer(questions: &[AgentQuestion], answer: &AgentQuestionAnswerItem) -> bool {
    let asked = questions
        .iter()
        .find(|question| question.id == answer.question_id);
    asked.is_some_and(|question| {
        bounded_answer(answer)
            && text(&answer.text, MAX_TEXT_BYTES)
            && (question.multiple || answer.option_ids.len() <= 1)
            && (question.allow_custom || answer.text.is_empty())
            && (!answer.option_ids.is_empty() || !blank(&answer.text))
            && unique(answer.option_ids.iter().map(String::as_str))
            && answer
                .option_ids
                .iter()
                .all(|chosen| question.options.iter().any(|offered| &offered.id == chosen))
    })
}

pub(super) fn answers(questions: &[AgentQuestion], answers: &[AgentQuestionAnswerItem]) -> bool {
    answers.len() == questions.len()
        && answers.iter().all(|item| answer(questions, item))
        && unique(answers.iter().map(|item| item.question_id.as_str()))
}

fn fact(fact: &AgentApprovalFact) -> bool {
    visible_text(&fact.label, MAX_AGENT_APPROVAL_FACT_LABEL_BYTES)
        && text(&fact.value, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES)
}

pub(super) fn approval(
    title: &str,
    detail: &str,
    facts: &[AgentApprovalFact],
    decisions: &[AgentApprovalDecision],
) -> bool {
    let mut offered = HashSet::new();
    visible_text(title, MAX_AGENT_APPROVAL_TITLE_BYTES)
        && text(detail, MAX_AGENT_APPROVAL_DETAIL_BYTES)
        && facts.len() <= MAX_AGENT_APPROVAL_FACTS
        && facts.iter().all(fact)
        && decisions.iter().all(|decision| offered.insert(*decision))
        && decisions.contains(&AgentApprovalDecision::Deny)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_text_follows_ecmascript_trim_not_rust_trim() {
        for whitespace in [
            "",
            " ",
            "\t\n\u{B}\u{C}\r",
            "\u{A0}\u{1680}\u{2000}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}",
            "\u{FEFF}",
            " \u{FEFF}\n",
        ] {
            assert!(blank(whitespace), "{whitespace:?}");
        }
        for visible in ["\u{85}", " \u{85} ", "\u{200B}", "\u{180E}", "x", " x "] {
            assert!(!blank(visible), "{visible:?}");
        }
        assert!("\u{85}".trim().is_empty());
        assert!(!"\u{FEFF}".trim().is_empty());
        assert!(visible_text("\u{85}", 8));
        assert!(!visible_text("\u{FEFF}", 8));
        assert!(!visible_text("x\0", 8));
        assert!(!visible_text("123456789", 8));
    }

    #[test]
    fn identifiers_match_the_runner_pattern() {
        for valid in ["a", "q0", "A.b:c_d-e", &"x".repeat(128)] {
            assert!(identifier(valid), "{valid}");
        }
        for invalid in ["", "-a", ".a", "a b", "a/b", "é", &"x".repeat(129)] {
            assert!(!identifier(invalid), "{invalid}");
        }
        assert!(provider("codex") && provider("claudeCode"));
        assert!(!provider("claude") && !provider(""));
    }

    #[test]
    fn budgeted_measurement_stops_at_the_limit() {
        assert!(within_budget(&"x".repeat(8), 10));
        assert!(!within_budget(&"x".repeat(9), 10));
        let mut budget = ByteBudget(4);
        assert!(std::io::Write::write(&mut budget, b"1234").is_ok());
        assert!(std::io::Write::write(&mut budget, b"5").is_err());
        assert!(!within_budget(&vec!["x".repeat(1024); 1024], 64));
    }
}
