use super::*;

const EXTERNAL_HISTORY_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/external-session-history-with-attachments.json");
const EXTERNAL_HISTORY_LEGACY_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/external-session-history-legacy-no-attachments.json");

fn document_with_fixture_history() -> AgentThreadDocument {
    let mut document = document_with_external_history();
    let origin = document.thread.external_origin.as_mut().unwrap();
    let mut history: AgentThreadExternalHistory =
        serde_json::from_str(EXTERNAL_HISTORY_FIXTURE).expect("shared fixture loads");
    history.provider = origin.provider;
    history.session_id = origin.session_id.clone();
    origin.history = Some(history);
    document
}

#[test]
fn external_history_attachments_round_trip_the_shared_fixture() {
    let history: AgentThreadExternalHistory =
        serde_json::from_str(EXTERNAL_HISTORY_FIXTURE).expect("shared fixture loads");
    assert_eq!(
        history.exchanges[0].attachments,
        vec![
            AgentThreadExternalAttachment::Image {
                mime: AgentImageMime::Png,
                name: None,
                path: None,
            },
            AgentThreadExternalAttachment::Image {
                mime: AgentImageMime::Jpeg,
                name: None,
                path: Some("/Users/dev/Pictures/probe.jpg".to_string()),
            },
            AgentThreadExternalAttachment::File {
                name: "notes.txt".to_string(),
                path: Some(
                    "/data/agent-attachments/threads/agt-t1-0001/112233445566778899001122334455aa.txt"
                        .to_string()
                ),
            },
        ]
    );
    let reencoded = serde_json::to_string_pretty(&history).expect("re-encode fixture");
    assert_eq!(format!("{reencoded}\n"), EXTERNAL_HISTORY_FIXTURE);

    let legacy: AgentThreadExternalHistory =
        serde_json::from_str(EXTERNAL_HISTORY_LEGACY_FIXTURE).expect("legacy fixture loads");
    assert!(legacy
        .exchanges
        .iter()
        .all(|exchange| exchange.attachments.is_empty()));
    let reencoded = serde_json::to_string_pretty(&legacy).expect("re-encode legacy");
    assert!(!reencoded.contains("attachments"));
    assert_eq!(format!("{reencoded}\n"), EXTERNAL_HISTORY_LEGACY_FIXTURE);

    let document = document_with_fixture_history();
    validate_agent_thread_document(ROOT_KEY, &document).expect("fixture history is within bounds");
    let temp = TempStore::create("external-history-attachments");
    let store = temp.store();
    store.save(ROOT_KEY, &document).expect("save history");
    let loaded = store.load(ROOT_KEY).expect("load history");
    assert_eq!(loaded.threads, vec![document.thread]);
}

#[test]
fn external_history_attachments_are_bounded_and_closed() {
    let document = document_with_fixture_history();
    let history = document
        .thread
        .external_origin
        .as_ref()
        .unwrap()
        .history
        .as_ref()
        .unwrap();
    let mut mutations = Vec::new();
    let mut too_many = history.clone();
    too_many.exchanges[0].attachments =
        vec![history.exchanges[0].attachments[0].clone(); MAX_AGENT_TURN_ATTACHMENTS + 1];
    mutations.push(too_many);
    let mut relative = history.clone();
    relative.exchanges[0].attachments = vec![AgentThreadExternalAttachment::Image {
        mime: AgentImageMime::Png,
        name: None,
        path: Some("Pictures/probe.png".to_string()),
    }];
    mutations.push(relative);
    let mut slashed_image_name = history.clone();
    slashed_image_name.exchanges[0].attachments = vec![AgentThreadExternalAttachment::Image {
        mime: AgentImageMime::Png,
        name: Some("dir/probe.png".to_string()),
        path: None,
    }];
    mutations.push(slashed_image_name);
    let mut text_only_bytes = history.clone();
    text_only_bytes.total_preview_bytes = text_only_bytes
        .exchanges
        .iter()
        .map(|exchange| exchange.text.len() as u64)
        .sum();
    assert_ne!(
        text_only_bytes.total_preview_bytes,
        history.total_preview_bytes
    );
    mutations.push(text_only_bytes);
    let mut fat_paths = history.clone();
    let fat_exchange = AgentThreadExternalExchange {
        role: AgentThreadExternalExchangeRole::User,
        text: "x".to_string(),
        attachments: (0..MAX_AGENT_TURN_ATTACHMENTS)
            .map(|index| AgentThreadExternalAttachment::Image {
                mime: AgentImageMime::Png,
                name: None,
                path: Some(format!(
                    "/{index}/{}",
                    "p".repeat(MAX_AGENT_ATTACHMENT_PATH_BYTES - 7)
                )),
            })
            .collect(),
    };
    let fat_exchange_bytes = fat_exchange.text.len()
        + fat_exchange
            .attachments
            .iter()
            .map(AgentThreadExternalAttachment::budget_bytes)
            .sum::<usize>();
    let fat_exchange_count = MAX_AGENT_EXTERNAL_HISTORY_BYTES / fat_exchange_bytes + 1;
    fat_paths.exchanges = vec![fat_exchange; fat_exchange_count];
    fat_paths.total_preview_bytes = (fat_exchange_count * fat_exchange_bytes) as u64;
    mutations.push(fat_paths);
    let mut slashed = history.clone();
    slashed.exchanges[0].attachments = vec![AgentThreadExternalAttachment::File {
        name: "dir/notes.txt".to_string(),
        path: None,
    }];
    mutations.push(slashed);
    let mut empty_name = history.clone();
    empty_name.exchanges[0].attachments = vec![AgentThreadExternalAttachment::File {
        name: String::new(),
        path: None,
    }];
    mutations.push(empty_name);
    for history in mutations {
        let mut invalid = document.clone();
        invalid.thread.external_origin.as_mut().unwrap().history = Some(history);
        assert!(validate_agent_thread_document(ROOT_KEY, &invalid).is_err());
    }
    let base = serde_json::to_value(&document).unwrap();
    let mut unknown_field = base.clone();
    unknown_field["thread"]["externalOrigin"]["history"]["exchanges"][0]["attachments"][0]
        ["bytes"] = json!(12);
    assert!(serde_json::from_value::<AgentThreadDocument>(unknown_field).is_err());
    let mut unknown_kind = base.clone();
    unknown_kind["thread"]["externalOrigin"]["history"]["exchanges"][0]["attachments"][0] =
        json!({"kind": "archive", "name": "x.zip"});
    assert!(serde_json::from_value::<AgentThreadDocument>(unknown_kind).is_err());
    let mut unknown_mime = base;
    unknown_mime["thread"]["externalOrigin"]["history"]["exchanges"][0]["attachments"][0] =
        json!({"kind": "image", "mime": "image/bmp"});
    assert!(serde_json::from_value::<AgentThreadDocument>(unknown_mime).is_err());
}
