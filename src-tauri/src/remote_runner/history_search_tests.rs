use super::*;
use serde_json::json;

fn request() -> HistorySearchRequest {
    serde_json::from_value(json!({"serverId":"linux","query":"needle"})).unwrap()
}
fn page() -> Value {
    json!({"items":[{"taskId":"7389088c-29b8-4cec-9a15-e825e1fb2f66","conversationId":"7389088c-29b8-4cec-9a15-e825e1fb2f67","projectId":null,"taskSequence":1,"role":"user","eventSequence":null,"snippet":"needle"}],"nextCursor":null,"scope":"retained_runner_history","incomplete":false})
}

#[test]
fn request_is_closed_and_encodes_literal_query() {
    let mut r = request();
    r.query = "  é &q=other/#?  ".into();
    r.project_id = Some("my/project & after=2".into());
    let path = search_path(&r).unwrap();
    let pairs: Vec<_> = url::form_urlencoded::parse(path.split_once('?').unwrap().1.as_bytes())
        .into_owned()
        .collect();
    assert_eq!(
        pairs,
        vec![
            ("q".into(), "é &q=other/#?".into()),
            ("after".into(), "0".into()),
            ("projectId".into(), "my/project & after=2".into())
        ]
    );
    assert!(serde_json::from_value::<HistorySearchRequest>(
        json!({"serverId":"linux","query":"needle","projectId":null})
    )
    .is_err());
    for key in ["host", "path", "headers", "command"] {
        let mut value = json!({"serverId":"linux","query":"needle"});
        value[key] = json!("foreign");
        assert!(serde_json::from_value::<HistorySearchRequest>(value).is_err());
    }
    for after in [json!(null), json!(-1), json!(1.5), json!("1")] {
        assert!(serde_json::from_value::<HistorySearchRequest>(
            json!({"serverId":"linux","query":"needle","after":after})
        )
        .is_err());
    }
}

#[test]
fn request_limits_match_javascript_utf16_lengths() {
    for query in [
        " ".into(),
        "a".into(),
        "a\0b".into(),
        "a\nb".into(),
        "é".repeat(257),
        "😀".repeat(129),
    ] {
        let mut r = request();
        r.query = query;
        assert!(search_path(&r).is_err());
    }
    let mut r = request();
    r.query = "😀".repeat(128);
    assert!(search_path(&r).is_ok());
    r.after = Some(MAX_SAFE_INTEGER + 1);
    assert!(search_path(&r).is_err());
    r.after = Some(MAX_SAFE_INTEGER);
    assert!(search_path(&r).is_ok());
    for project in ["".into(), "a\0b".into(), "😀".repeat(65)] {
        r.project_id = Some(project);
        assert!(search_path(&r).is_err());
    }
    r.project_id = None;
    r.server_id = "../server".into();
    assert!(search_path(&r).is_err());
}

#[test]
fn page_requires_closed_fields_and_supported_roles() {
    assert!(validate_page(page(), &request()).is_ok());
    for key in ["scope", "items", "nextCursor", "incomplete"] {
        let mut v = page();
        v.as_object_mut().unwrap().remove(key);
        assert!(validate_page(v, &request()).is_err(), "missing {key}");
    }
    for key in [
        "taskId",
        "conversationId",
        "projectId",
        "taskSequence",
        "role",
        "eventSequence",
        "snippet",
    ] {
        let mut v = page();
        v["items"][0].as_object_mut().unwrap().remove(key);
        assert!(validate_page(v, &request()).is_err(), "missing {key}");
    }
    let mut v = page();
    v["extra"] = json!(true);
    assert!(validate_page(v, &request()).is_err());
    let mut v = page();
    v["items"][0]["extra"] = json!(true);
    assert!(validate_page(v, &request()).is_err());
    for role in ["tool", "system", "Assistant"] {
        let mut v = page();
        v["items"][0]["role"] = json!(role);
        assert!(validate_page(v, &request()).is_err());
    }
}

#[test]
fn page_validates_sequences_scope_bounds_and_owner() {
    for (field, values) in [
        (
            "taskSequence",
            vec![json!(0), json!(-1), json!(MAX_SAFE_INTEGER + 1), json!(1.5)],
        ),
        (
            "eventSequence",
            vec![json!(1), json!(-1), json!(MAX_SAFE_INTEGER + 1)],
        ),
        (
            "projectId",
            vec![json!(""), json!(1), json!("x".repeat(129))],
        ),
        ("snippet", vec![json!("😀".repeat(383)), json!("a\0b")]),
    ] {
        for value in values {
            let mut v = page();
            v["items"][0][field] = value;
            assert!(validate_page(v, &request()).is_err(), "{field}");
        }
    }
    let mut v = page();
    v["items"][0]["snippet"] = json!("😀".repeat(382));
    assert!(validate_page(v, &request()).is_ok());
    let mut v = page();
    v["items"][0]["role"] = json!("assistant");
    assert!(validate_page(v.clone(), &request()).is_err());
    v["items"][0]["eventSequence"] = json!(1);
    assert!(validate_page(v, &request()).is_ok());
    let mut r = request();
    r.project_id = Some("project".into());
    assert!(validate_page(page(), &r).is_err());
    r.project_id = None;
    r.after = Some(1);
    assert!(validate_page(page(), &r).is_err());
    for cursor in [json!(0), json!(-1), json!(MAX_SAFE_INTEGER + 1), json!(0.5)] {
        let mut v = page();
        v["nextCursor"] = cursor;
        assert!(validate_page(v, &request()).is_err());
    }
    let mut v = page();
    v["items"] = json!([]);
    v["nextCursor"] = json!(10);
    assert!(validate_page(v, &request()).is_ok());
    let mut v = page();
    v["items"] = json!(vec![page()["items"][0].clone(); 21]);
    assert!(validate_page(v, &request()).is_err());
    let mut v = page();
    v["items"] = json!(vec![page()["items"][0].clone(); 2]);
    assert!(validate_page(v, &request()).is_err());
}
