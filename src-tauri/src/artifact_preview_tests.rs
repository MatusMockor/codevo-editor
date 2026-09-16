use super::*;
#[test]
fn lifecycle_is_bounded_unique_and_revocable() {
    let state = ArtifactPreviewState::default();
    let now = Instant::now();
    let first = state.create("<button>Hello</button>".into(), now).unwrap();
    let second = state.create("other".into(), now).unwrap();
    assert_ne!(first.token, second.token);
    assert_eq!(
        &*state.read(&first.token, now).unwrap(),
        b"<button>Hello</button>"
    );
    state.revoke(&first.token).unwrap();
    assert!(state.read(&first.token, now).is_none());
    state.revoke(&first.token).unwrap();
    assert!(state.read(&second.token, now + TTL).is_none());
}
#[test]
fn capacity_and_utf8_byte_limit_fail_closed() {
    let state = ArtifactPreviewState::default();
    let now = Instant::now();
    assert!(state.create(String::new(), now).is_err());
    assert!(state.create("\0".into(), now).is_err());
    assert!(state.create("é".repeat(HTML_LIMIT / 2 + 1), now).is_err());
    for _ in 0..ENTRY_LIMIT {
        state.create("x".repeat(HTML_LIMIT), now).unwrap();
    }
    assert!(state.create("x".into(), now).is_err());
    assert!(state.create("x".into(), now + TTL).is_ok());
}
#[test]
fn routes_deny_traversal_foreign_authorities_queries_and_methods() {
    let id = "a".repeat(64);
    for url in [
        format!("{SCHEME}://localhost/{id}"),
        format!("http://{SCHEME}.localhost/{id}"),
    ] {
        assert_eq!(
            request_token(&Request::builder().uri(url).body(vec![]).unwrap()),
            Some(id.as_str())
        );
    }
    for url in [
        format!("{SCHEME}://evil/{id}"),
        format!("http://{SCHEME}.localhost.evil/{id}"),
        format!("{SCHEME}://localhost/{id}?x=1"),
        format!("{SCHEME}://localhost/{id}/../x"),
        format!("{SCHEME}://localhost/%61{}", "a".repeat(63)),
        format!("{SCHEME}://localhost:80/{id}"),
    ] {
        assert!(request_token(&Request::builder().uri(url).body(vec![]).unwrap()).is_none());
    }
    assert!(request_token(
        &Request::builder()
            .method("POST")
            .uri(format!("{SCHEME}://localhost/{id}"))
            .body(vec![])
            .unwrap()
    )
    .is_none());
}
#[test]
fn responses_always_enforce_isolation_including_not_found() {
    for body in [None, Some(Arc::from(&b"<script>1</script>"[..]))] {
        let result = response(body);
        assert_eq!(result.headers()["content-security-policy"], CSP);
        assert!(!CSP.contains("allow-same-origin"));
        assert_eq!(result.headers()["cache-control"], "no-store");
        assert_eq!(result.headers()["referrer-policy"], "no-referrer");
    }
}
#[test]
fn requests_reject_unknown_fields() {
    assert!(serde_json::from_str::<CreateRequest>(r#"{"html":"x","url":"evil"}"#).is_err());
    assert!(serde_json::from_str::<RevokeRequest>(r#"{"token":"x","owner":"foreign"}"#).is_err());
}
