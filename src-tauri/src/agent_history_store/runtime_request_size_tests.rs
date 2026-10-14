use super::*;
use crate::agent_questions::approvals::{
    AgentApprovalFact, MAX_AGENT_APPROVAL_DETAIL_BYTES, MAX_AGENT_APPROVAL_FACTS,
    MAX_AGENT_APPROVAL_FACT_LABEL_BYTES, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES,
    MAX_AGENT_APPROVAL_TITLE_BYTES,
};
use crate::agent_questions::{
    AgentQuestionOption, MAX_AGENT_QUESTIONS_PER_REQUEST, MAX_AGENT_QUESTION_ANSWER_TEXT_BYTES,
    MAX_AGENT_QUESTION_HEADER_BYTES, MAX_AGENT_QUESTION_ID_BYTES, MAX_AGENT_QUESTION_OPTIONS,
    MAX_AGENT_QUESTION_OPTION_DESCRIPTION_BYTES, MAX_AGENT_QUESTION_OPTION_LABEL_BYTES,
    MAX_AGENT_QUESTION_PROMPT_BYTES,
};
use crate::agent_runtime_requests::limits::{
    MAX_APPROVAL_BODY_BYTES, MAX_JSON_BYTES_PER_TEXT_BYTE, MAX_QUESTION_BODY_BYTES,
};
use crate::agent_runtime_requests::store::{MAX_READ_REQUEST_BYTES, MAX_REQUEST_OUTCOME_BYTES};

const QUOTE: &str = "\"";
const CONTROL: &str = "\u{1}";

fn identifier(prefix: &str, index: usize) -> String {
    format!(
        "{:x<width$}",
        format!("{prefix}{index}-"),
        width = MAX_AGENT_QUESTION_ID_BYTES
    )
}

fn largest_question(filler: &str) -> ObservedRequest {
    let questions = (0..MAX_AGENT_QUESTIONS_PER_REQUEST)
        .map(|index| AgentQuestion {
            id: identifier("q", index),
            header: filler.repeat(MAX_AGENT_QUESTION_HEADER_BYTES),
            prompt: filler.repeat(MAX_AGENT_QUESTION_PROMPT_BYTES),
            options: (0..MAX_AGENT_QUESTION_OPTIONS)
                .map(|option| AgentQuestionOption {
                    id: identifier("o", option),
                    label: filler.repeat(MAX_AGENT_QUESTION_OPTION_LABEL_BYTES),
                    description: filler.repeat(MAX_AGENT_QUESTION_OPTION_DESCRIPTION_BYTES),
                })
                .collect(),
            multiple: true,
            allow_custom: true,
        })
        .collect();
    ObservedRequest {
        body: RequestBody::Question { questions },
        ..question("question-1", ObservedState::Pending)
    }
}

fn largest_answers(filler: &str) -> RequestResolution {
    RequestResolution::Answers {
        answers: (0..MAX_AGENT_QUESTIONS_PER_REQUEST)
            .map(|index| AgentQuestionAnswerItem {
                question_id: identifier("q", index),
                option_ids: (0..MAX_AGENT_QUESTION_OPTIONS)
                    .map(|option| identifier("o", option))
                    .collect(),
                text: filler.repeat(MAX_AGENT_QUESTION_ANSWER_TEXT_BYTES),
            })
            .collect(),
    }
}

fn largest_approval(filler: &str) -> ObservedRequest {
    ObservedRequest {
        body: RequestBody::Approval {
            approval_kind: AgentApprovalKind::McpElicitation,
            title: filler.repeat(MAX_AGENT_APPROVAL_TITLE_BYTES),
            detail: filler.repeat(MAX_AGENT_APPROVAL_DETAIL_BYTES),
            detail_truncated: false,
            facts: (0..MAX_AGENT_APPROVAL_FACTS)
                .map(|_| AgentApprovalFact {
                    label: filler.repeat(MAX_AGENT_APPROVAL_FACT_LABEL_BYTES),
                    value: filler.repeat(MAX_AGENT_APPROVAL_FACT_VALUE_BYTES),
                })
                .collect(),
            decisions: vec![
                AgentApprovalDecision::AllowOnce,
                AgentApprovalDecision::AllowForSession,
                AgentApprovalDecision::Deny,
            ],
        },
        ..approval("approval-1", ObservedState::Pending)
    }
}

fn stored_bytes(journaled: &Journaled, request_id: &str) -> (usize, usize) {
    let (body, outcome): (i64, i64) = journaled
        .raw()
        .query_row(
            "SELECT LENGTH(CAST(body AS BLOB)),IFNULL(LENGTH(CAST(outcome AS BLOB)),0)
             FROM runtime_requests WHERE request_id=?1",
            [request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    (body as usize, outcome as usize)
}

fn fills(stored: usize, limit: usize) -> bool {
    stored <= limit && stored * 100 >= limit * 98
}

fn answered(journaled: &Journaled, mut asked: ObservedRequest, sent: &RequestResolution) -> Value {
    let id = asked.id.clone();
    assert!(asked.body.validate(&id, asked.provider).is_ok());
    assert!(sent.validate_for(&id, asked.provider, &asked.body).is_ok());
    let registered = journaled.apply(RUN, &snapshot(1, vec![asked.clone()]));
    assert_eq!((registered.transitions, registered.skipped), (1, 0));
    let receipt = journaled.store.record_intent(
        &journaled.scope,
        RUN,
        &intent(&id, sent.clone(), 2),
        before_deadline(),
    );
    assert_eq!(receipt, Ok(IntentReceipt::Recorded));
    let submitting = journaled.only();
    assert_eq!(submitting["status"], json!("submitting"));
    assert_eq!(
        submitting["resolution"],
        serde_json::to_value(sent).unwrap()
    );

    asked.state = ObservedState::Resolved(sent.clone());
    let resolved = journaled.apply(RUN, &snapshot(3, vec![asked.clone()]));
    assert_eq!((resolved.transitions, resolved.lost_answers), (1, 0));

    let read = journaled.read();
    assert_eq!((read.unreadable, read.truncated), (0, false));
    assert_eq!(read.requests.len(), 1);
    assert_eq!(read.requests[0].parts().body, asked.body);
    let stored = journaled.only();
    assert_eq!(stored["status"], json!("resolved"));
    assert_eq!(stored["resolution"], serde_json::to_value(sent).unwrap());
    stored
}

#[test]
fn four_longest_answers_of_quote_characters_round_trip_through_intent_resolution_and_read() {
    let journaled = Journaled::new();
    let mut asked = question("question-1", ObservedState::Pending);
    asked.body = RequestBody::Question {
        questions: (0..4)
            .map(|index| AgentQuestion {
                id: format!("q{index}"),
                header: String::new(),
                prompt: "Explain".into(),
                options: Vec::new(),
                multiple: false,
                allow_custom: true,
            })
            .collect(),
    };
    let sent = RequestResolution::Answers {
        answers: (0..4)
            .map(|index| AgentQuestionAnswerItem {
                question_id: format!("q{index}"),
                option_ids: Vec::new(),
                text: QUOTE.repeat(8192),
            })
            .collect(),
    };

    let stored = answered(&journaled, asked, &sent);

    for index in 0..4 {
        assert_eq!(
            stored["resolution"]["answers"][index]["text"],
            json!(QUOTE.repeat(8192))
        );
    }
    let (_, outcome) = stored_bytes(&journaled, "question-1");
    assert!(outcome > 4 * 8192 * 2);
    assert!(outcome <= MAX_REQUEST_OUTCOME_BYTES);
}

#[test]
fn largest_valid_question_and_answers_fill_their_limits_and_are_stored_whole() {
    for filler in [QUOTE, CONTROL] {
        let journaled = Journaled::new();

        answered(
            &journaled,
            largest_question(filler),
            &largest_answers(filler),
        );

        let (body, outcome) = stored_bytes(&journaled, "question-1");
        assert!(body <= MAX_QUESTION_BODY_BYTES, "{body}");
        assert!(outcome <= MAX_REQUEST_OUTCOME_BYTES, "{outcome}");
        let escaped: String = serde_json::to_string(filler).unwrap();
        if escaped.len() - 2 < MAX_JSON_BYTES_PER_TEXT_BYTE {
            continue;
        }
        assert!(fills(body, MAX_QUESTION_BODY_BYTES), "{body}");
        assert!(fills(outcome, MAX_REQUEST_OUTCOME_BYTES), "{outcome}");
    }
}

#[test]
fn largest_valid_approval_fills_its_limit_and_is_stored_whole() {
    let journaled = Journaled::new();

    answered(&journaled, largest_approval(CONTROL), &decision());

    let (body, _) = stored_bytes(&journaled, "approval-1");
    assert!(fills(body, MAX_APPROVAL_BODY_BYTES), "{body}");
    assert_eq!(
        MAX_REQUEST_BODY_BYTES,
        MAX_QUESTION_BODY_BYTES.max(MAX_APPROVAL_BODY_BYTES)
    );
}

#[test]
fn no_character_a_validator_accepts_encodes_to_more_bytes_than_the_limits_assume() {
    let widest = (1..=0x7f_u8)
        .map(|byte| {
            let text = char::from(byte).to_string();
            serde_json::to_string(&text).unwrap().len() - 2
        })
        .max();
    assert_eq!(widest, Some(MAX_JSON_BYTES_PER_TEXT_BYTE));
    for character in ['\u{80}', '\u{7ff}', '\u{2028}', '\u{ffff}', '\u{10ffff}'] {
        let text = character.to_string();
        assert_eq!(serde_json::to_string(&text).unwrap().len() - 2, text.len());
    }
}

fn beyond_any_valid_answer() -> RequestResolution {
    answers(&CONTROL.repeat(MAX_REQUEST_OUTCOME_BYTES / MAX_JSON_BYTES_PER_TEXT_BYTE + 1))
}

#[test]
fn answer_beyond_the_limit_is_closed_as_lost_and_stays_reported_after_a_restart() {
    let journaled = Journaled::new();
    let mut oversized = question("question-big", ObservedState::Pending);
    oversized.body =
        question_body(&CONTROL.repeat(MAX_REQUEST_BODY_BYTES / MAX_JSON_BYTES_PER_TEXT_BYTE + 1));
    let mut listed = vec![question("question-1", ObservedState::Pending), oversized];
    assert_eq!(
        journaled
            .apply(RUN, &snapshot(1, listed.clone()))
            .transitions,
        2
    );
    assert_eq!(stored_bytes(&journaled, "question-big"), (0, 0));
    assert_eq!(journaled.read().unreadable, 1);
    let lost = beyond_any_valid_answer();
    let receipt = |request_id: &str, version: u64| {
        journaled.store.record_intent(
            &journaled.scope,
            RUN,
            &intent(request_id, lost.clone(), version),
            before_deadline(),
        )
    };
    assert_eq!(receipt("question-1", 2), Ok(IntentReceipt::Refused));
    assert_eq!(
        receipt("question-big", 3),
        Ok(IntentReceipt::RecordedWithoutAnswer)
    );

    for request in &mut listed {
        request.state = ObservedState::Resolved(lost.clone());
    }
    let resolved = journaled.apply(RUN, &snapshot(4, listed.clone()));
    assert_eq!((resolved.transitions, resolved.lost_answers), (2, 2));
    let relisted = journaled.apply(RUN, &snapshot(5, listed));
    assert_eq!(
        (
            relisted.transitions,
            relisted.lost_answers,
            relisted.skipped
        ),
        (0, 0, 0)
    );

    let closed_without_answers = |journaled: &Journaled| {
        let read = journaled.read();
        (read.requests.len(), read.unreadable, read.truncated)
    };
    assert_eq!(closed_without_answers(&journaled), (0, 2, true));
    for request_id in ["question-1", "question-big"] {
        assert_eq!(stored_bytes(&journaled, request_id), (0, 0), "{request_id}");
    }
    assert!(journaled
        .dump()
        .iter()
        .all(|row| row.split(':').nth(1) == Some("resolved")));
    journaled.recover_as(NEXT_RUN, 9_000_000);
    assert_eq!(closed_without_answers(&journaled), (0, 2, true));
}

#[test]
fn limits_are_the_documented_sums_of_the_validator_limits_at_six_bytes_per_text_byte() {
    let answer = 256 + 128 + 12 * (128 + 3) + 6 * 8192;
    assert_eq!(MAX_REQUEST_OUTCOME_BYTES, 256 + 4 * answer);
    assert_eq!(MAX_REQUEST_OUTCOME_BYTES, 204_688);

    let option = 256 + 128 + 6 * 512 + 6 * 2048;
    let asked = 256 + 128 + 6 * 128 + 6 * 8192 + 12 * option;
    assert_eq!(MAX_QUESTION_BODY_BYTES, 2 * 256 + 4 * asked);
    assert_eq!(MAX_QUESTION_BODY_BYTES, 957_440);

    let fact = 256 + 6 * 64 + 6 * 2048;
    assert_eq!(
        MAX_APPROVAL_BODY_BYTES,
        3 * 256 + 6 * 256 + 6 * 16_384 + 8 * fact
    );
    assert_eq!(MAX_APPROVAL_BODY_BYTES, 204_032);
    assert_eq!(MAX_REQUEST_BODY_BYTES, 957_440);
}

#[test]
fn read_budget_is_applied_from_stored_sizes_before_any_payload_is_loaded() {
    let journaled = Journaled::new();
    let open = question("question-open", ObservedState::Pending);
    let mut listed = vec![open];
    journaled.apply(RUN, &snapshot(1, listed.clone()));
    for index in 1..=5 {
        listed.push(ObservedRequest {
            id: format!("question-big-{index}"),
            state: expired(),
            ..largest_question(CONTROL)
        });
        let report = journaled.apply(RUN, &snapshot(1 + index, listed.clone()));
        assert_eq!((report.transitions, report.skipped), (1, 0), "{index}");
    }
    let (stored, _) = stored_bytes(&journaled, "question-big-1");
    assert!(4 * stored <= MAX_READ_REQUEST_BYTES && 5 * stored > MAX_READ_REQUEST_BYTES);
    journaled
        .raw()
        .execute(
            "INSERT INTO runtime_requests(thread_id,turn_id,request_id,kind,status,reason,
                run_id,version,reg_index,format,body,outcome,anchor_tool_id,created_at,
                updated_at,resolved_at)
             SELECT thread_id,turn_id,'question-undecodable',kind,'expired','turnEnded',run_id,
                1,99,format,hex(zeroblob(?1)),NULL,NULL,9000000,9000000,9000000
             FROM runtime_requests WHERE request_id='question-open'",
            [MAX_READ_REQUEST_BYTES as i64],
        )
        .unwrap();

    let read = journaled.read();

    let ids: Vec<&str> = read
        .requests
        .iter()
        .map(|request| request.parts().id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "question-open",
            "question-big-2",
            "question-big-3",
            "question-big-4",
            "question-big-5"
        ]
    );
    assert_eq!((read.truncated, read.unreadable), (true, 0));

    journaled
        .raw()
        .execute(
            "UPDATE runtime_requests SET body='{' WHERE request_id='question-undecodable'",
            [],
        )
        .unwrap();
    let read = journaled.read();
    assert_eq!(read.requests.len(), 5);
    assert_eq!((read.truncated, read.unreadable), (true, 1));
}
