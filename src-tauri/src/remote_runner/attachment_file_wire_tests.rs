use super::*;
use serde_json::json;

const UUID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const SOURCE: &str = "00000000-0000-4000-8000-000000000001";
const SHA: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn invalid_ids() -> [&'static str; 5] {
    [
        "",
        "../attachment",
        "attachment?token=secret",
        "attachment/content",
        "attachment\n",
    ]
}

#[test]
fn upload_requests_are_closed_and_validate_every_identifier() {
    let input =
        json!({"serverId":"linux","attachmentId":UUID,"sourceId":SOURCE,"name":"report.pdf"});
    let request: UploadFileRequest = serde_json::from_value(input.clone()).unwrap();
    assert_eq!(request.validate(), Ok(()));
    assert_eq!(request.path(), format!("/v1/attachments/{UUID}"));
    for field in [
        "path",
        "mediaType",
        "base64",
        "bytes",
        "url",
        "headers",
        "token",
    ] {
        let mut unknown = input.clone();
        unknown[field] = "foreign".into();
        assert!(serde_json::from_value::<UploadFileRequest>(unknown).is_err());
    }
    for field in ["serverId", "attachmentId", "sourceId", "name"] {
        let mut missing = input.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<UploadFileRequest>(missing).is_err());
    }
    for field in ["serverId", "attachmentId", "sourceId"] {
        for value in invalid_ids() {
            let mut invalid = input.clone();
            invalid[field] = value.into();
            let request: UploadFileRequest = serde_json::from_value(invalid).unwrap();
            assert!(request.validate().is_err(), "{field} {value:?}");
        }
    }
    for field in ["attachmentId", "sourceId"] {
        let mut uppercase = input.clone();
        uppercase[field] = UUID.to_uppercase().into();
        let request: UploadFileRequest = serde_json::from_value(uppercase).unwrap();
        assert!(request.validate().is_err(), "{field}");
    }
    let mut foreign_source = input.clone();
    foreign_source["sourceId"] = "/etc/passwd".into();
    let request: UploadFileRequest = serde_json::from_value(foreign_source).unwrap();
    assert_eq!(request.validate().unwrap_err(), INVALID_SOURCE);
}

#[test]
fn upload_names_follow_the_runner_rules_and_are_percent_encoded() {
    let named = |name: &str| UploadFileRequest {
        server_id: "linux".into(),
        attachment_id: UUID.into(),
        source_id: SOURCE.into(),
        name: name.into(),
    };
    for name in [
        "a",
        "správa (1).pdf",
        ".env",
        "100%.txt",
        "a\u{85}b",
        &"ž".repeat(127),
    ] {
        assert_eq!(named(name).validate(), Ok(()), "{name}");
    }
    for name in [
        "",
        " \t ",
        "a/b",
        "a\\b",
        "a\0b",
        "a\rb",
        "a\u{7f}b",
        &"x".repeat(256),
        &"ž".repeat(128),
    ] {
        assert_eq!(
            named(name).validate().unwrap_err(),
            FILE_REFUSED,
            "{name:?}"
        );
    }
    assert_eq!(
        named("správa (1)+50%.pdf").file_name_header(),
        "spr%C3%A1va%20%281%29%2B50%25.pdf"
    );
    let longest = named(&"ž".repeat(127)).file_name_header();
    assert!(longest.is_ascii() && longest.len() <= 1024);
}

#[test]
fn cancel_requests_are_closed_and_validate_both_identifiers() {
    let input = json!({"serverId":"linux","attachmentId":UUID});
    let request: CancelUploadRequest = serde_json::from_value(input.clone()).unwrap();
    assert_eq!(request.validate(), Ok(()));
    let mut unknown = input.clone();
    unknown["sourceId"] = SOURCE.into();
    assert!(serde_json::from_value::<CancelUploadRequest>(unknown).is_err());
    for field in ["serverId", "attachmentId"] {
        for value in invalid_ids() {
            let mut invalid = input.clone();
            invalid[field] = value.into();
            let request: CancelUploadRequest = serde_json::from_value(invalid).unwrap();
            assert!(request.validate().is_err(), "{field} {value:?}");
        }
    }
}

#[test]
fn download_requests_are_closed_bounded_and_never_carry_a_destination() {
    let input =
        json!({"serverId":"linux","attachmentId":UUID,"name":"report.pdf","bytes":7,"sha256":SHA});
    let request: DownloadRequest = serde_json::from_value(input.clone()).unwrap();
    assert_eq!(request.validate(), Ok(()));
    assert_eq!(request.path(), format!("/v1/attachments/{UUID}/content"));
    for field in ["path", "destination", "directory", "url", "mediaType"] {
        let mut unknown = input.clone();
        unknown[field] = "/tmp/out".into();
        assert!(serde_json::from_value::<DownloadRequest>(unknown).is_err());
    }
    for (field, value) in [
        ("bytes", json!(0)),
        ("bytes", json!(52_428_801_u64)),
        ("sha256", json!("")),
        ("sha256", json!(SHA.to_uppercase())),
        ("sha256", json!(&SHA[..63])),
        ("sha256", json!(format!("{}g", &SHA[..63]))),
        ("name", json!("")),
        ("name", json!("  ")),
        ("name", json!("a\nb")),
        ("name", json!("x".repeat(256))),
        ("serverId", json!("../linux")),
        ("attachmentId", json!("attachment")),
    ] {
        let mut invalid = input.clone();
        invalid[field] = value.clone();
        let request: DownloadRequest = serde_json::from_value(invalid).unwrap();
        assert!(request.validate().is_err(), "{field} {value}");
    }
    for (field, value) in [
        ("bytes", json!(-1)),
        ("bytes", json!(1.5)),
        ("bytes", json!("7")),
    ] {
        let mut invalid = input.clone();
        invalid[field] = value;
        assert!(serde_json::from_value::<DownloadRequest>(invalid).is_err());
    }
    let mut largest = input.clone();
    largest["bytes"] = json!(52_428_800_u64);
    let request: DownloadRequest = serde_json::from_value(largest).unwrap();
    assert_eq!(request.validate(), Ok(()));
}

#[test]
fn the_suggested_file_name_cannot_leave_the_chosen_directory() {
    let named = |name: &str| DownloadRequest {
        server_id: "linux".into(),
        attachment_id: UUID.into(),
        name: name.into(),
        bytes: 1,
        sha256: SHA.into(),
    };
    for (name, expected) in [
        ("report.pdf", "report.pdf"),
        ("../../etc/passwd", "_.._etc_passwd"),
        ("C:\\Users\\a.txt", "C__Users_a.txt"),
        ("...", "attachment"),
        (" . hidden", "hidden"),
        ("správa.pdf", "správa.pdf"),
        ("a\u{85}b.txt", "a_b.txt"),
    ] {
        let suggested = named(name).suggested_name();
        assert_eq!(suggested, expected);
        assert!(!suggested.contains(['/', '\\', ':']) && !suggested.starts_with('.'));
    }
}

#[test]
fn direction_controls_cannot_disguise_the_extension_of_the_suggested_name() {
    let named = |name: &str| DownloadRequest {
        server_id: "linux".into(),
        attachment_id: UUID.into(),
        name: name.into(),
        bytes: 1,
        sha256: SHA.into(),
    };
    for (name, expected) in [
        ("invoice\u{202e}fdp.exe", "invoicefdp.exe"),
        ("a\u{2066}b\u{2069}.sh", "ab.sh"),
        ("\u{200f}\u{200e}\u{061c}report.pdf", "report.pdf"),
        (
            "x\u{202a}\u{202b}\u{202c}\u{202d}\u{2067}\u{2068}.txt",
            "x.txt",
        ),
        ("\u{202e}", "attachment"),
        ("\u{202e}.\u{202e}.hidden", "hidden"),
    ] {
        let request = named(name);
        assert_eq!(request.validate(), Ok(()), "{name:?}");
        let suggested = request.suggested_name();
        assert_eq!(suggested, expected, "{name:?}");
        assert!(!suggested.chars().any(is_direction_control));
    }
    for kept in ['\u{200d}', '\u{2065}', '\u{206a}', '\u{2029}', 'é', '中'] {
        assert!(!is_direction_control(kept), "{kept:?}");
    }
}

#[test]
fn outcomes_serialize_to_the_contract_shape() {
    assert_eq!(
        serde_json::to_value(DownloadOutcome {
            status: DownloadStatus::Saved
        })
        .unwrap(),
        json!({"status":"saved"})
    );
    assert_eq!(
        serde_json::to_value(DownloadOutcome {
            status: DownloadStatus::Cancelled
        })
        .unwrap(),
        json!({"status":"cancelled"})
    );
}

fn reply() -> serde_json::Value {
    json!({
        "attachment": {
            "id": UUID, "runnerId": "runner", "name": "report.pdf", "bytes": 7,
            "sha256": SHA, "createdAt": "2026-10-13T00:00:00.000Z",
            "kind": "file", "mediaType": "application/pdf",
        },
        "created": true,
    })
}

fn sent() -> Sent<'static> {
    Sent {
        id: UUID,
        runner_id: "runner",
        name: "report.pdf",
        bytes: 7,
        sha256: SHA,
        media_type: "application/pdf",
    }
}

#[test]
fn a_matching_reply_is_returned_in_the_closed_contract_shape() {
    let body = reply().to_string();
    let accepted = stored(201, body.as_bytes(), &sent()).unwrap();
    assert_eq!(serde_json::to_value(&accepted).unwrap(), reply());
    let mut repeated = reply();
    repeated["created"] = false.into();
    let accepted = stored(200, repeated.to_string().as_bytes(), &sent()).unwrap();
    assert!(!accepted.created);
    let unpinned = Sent {
        runner_id: "",
        ..sent()
    };
    assert!(stored(201, body.as_bytes(), &unpinned).is_ok());
}

#[test]
fn a_malformed_reply_is_an_invalid_response() {
    let mut cases = vec![
        (201, "".to_string()),
        (201, "null".to_string()),
        (201, "[]".to_string()),
        (201, "{\"attachment\":".to_string()),
        (200, reply().to_string()),
        (204, reply().to_string()),
        (202, reply().to_string()),
    ];
    for (field, value) in [
        ("width", json!(1)),
        ("height", json!(1)),
        ("path", json!("/data/blob")),
        ("bytes", json!("7")),
        ("bytes", json!(7.5)),
        ("bytes", json!(-7)),
        ("kind", json!(null)),
        ("createdAt", json!(1)),
        ("createdAt", json!("")),
        ("createdAt", json!("x".repeat(65))),
        ("runnerId", json!("")),
        ("runnerId", json!("r".repeat(129))),
    ] {
        let mut malformed = reply();
        malformed["attachment"][field] = value;
        cases.push((201, malformed.to_string()));
    }
    for field in [
        "id",
        "runnerId",
        "name",
        "bytes",
        "sha256",
        "createdAt",
        "kind",
        "mediaType",
    ] {
        let mut missing = reply();
        missing["attachment"].as_object_mut().unwrap().remove(field);
        cases.push((201, missing.to_string()));
    }
    let mut extra = reply();
    extra["evicted"] = json!([]);
    cases.push((201, extra.to_string()));
    let mut uncreated = reply();
    uncreated["created"] = false.into();
    cases.push((201, uncreated.to_string()));
    for (status, body) in cases {
        assert_eq!(
            stored(status, body.as_bytes(), &sent()).unwrap_err(),
            INVALID_RESPONSE,
            "{status} {body}"
        );
    }
}

#[test]
fn a_reply_describing_another_file_is_a_mismatch() {
    for (field, value) in [
        ("id", json!("00000000-0000-4000-8000-000000000009")),
        ("runnerId", json!("another-runner")),
        ("name", json!("Report.pdf")),
        ("bytes", json!(8)),
        ("sha256", json!("0".repeat(64))),
        ("kind", json!("image")),
        ("mediaType", json!("application/octet-stream")),
    ] {
        let mut different = reply();
        different["attachment"][field] = value;
        assert_eq!(
            stored(201, different.to_string().as_bytes(), &sent()).unwrap_err(),
            STORED_DIFFERENT,
            "{field}"
        );
    }
}

#[test]
fn transfer_failures_map_to_the_exact_contract_strings() {
    for (failure, expected) in [
        (Failure::Cancelled, "Attachment upload was cancelled."),
        (Failure::Status(413), "File is larger than 50 MiB."),
        (
            Failure::Status(429),
            "The server's attachment storage is full. Try again later.",
        ),
        (
            Failure::Status(400),
            "The server does not accept this file.",
        ),
        (
            Failure::Status(415),
            "The server does not accept this file.",
        ),
        (Failure::Status(503), "Runner request failed (HTTP 503)."),
        (Failure::Status(404), "Runner request failed (HTTP 404)."),
        (Failure::Exceeded, "Runner response exceeds output limit."),
        (Failure::Local, "The file could not be read."),
        (Failure::Unsupported, "Update this server to attach files."),
        (Failure::Transport("reason".into()), "reason"),
    ] {
        assert_eq!(upload_refusal(failure), expected);
    }
    for (failure, expected) in [
        (
            Failure::Status(404),
            "The server no longer stores this attachment.",
        ),
        (Failure::Status(503), "Runner request failed (HTTP 503)."),
        (Failure::Status(413), "Runner request failed (HTTP 413)."),
        (
            Failure::Exceeded,
            "The downloaded file does not match the attachment.",
        ),
        (Failure::Cancelled, "Runner operation failed"),
        (Failure::Local, "The file could not be saved."),
        (Failure::Unsupported, "Runner operation failed"),
        (Failure::Transport("reason".into()), "reason"),
    ] {
        assert_eq!(download_refusal(failure), expected);
    }
    assert_eq!(SAVE_FAILED, "The file could not be saved.");
    assert_eq!(
        STORED_DIFFERENT,
        "The server stored a different file than was sent."
    );
    assert_eq!(
        crate::agent_file_source::NOT_STAGED,
        "The attached file is no longer staged. Attach it again."
    );
    assert_eq!(
        crate::agent_file_source::CHANGED,
        "The attached file changed. Attach it again."
    );
    assert_eq!(crate::agent_file_source::EMPTY, "File is empty.");
    assert_eq!(
        crate::agent_file_source::UNREADABLE,
        "The file could not be read."
    );
    assert_eq!(
        crate::agent_file_source::NOT_REGULAR,
        "Choose a regular file, not a symbolic link or special file."
    );
}
