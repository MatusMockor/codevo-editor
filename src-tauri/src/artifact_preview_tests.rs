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
fn dead_frames_render_a_static_notice_instead_of_a_blank_body() {
    let state = ArtifactPreviewState::default();
    let now = Instant::now();
    let handle = state.create("<h1>Live</h1>".into(), now).unwrap();
    let live = response(state.read(&handle.token, now));
    assert_eq!(live.status(), 200);
    assert_eq!(live.body(), b"<h1>Live</h1>");

    state.revoke(&handle.token).unwrap();
    let revoked = response(state.read(&handle.token, now));
    assert_eq!(revoked.status(), 404);
    assert_eq!(revoked.body(), UNAVAILABLE.as_bytes());
    assert!(!revoked.body().is_empty());
    assert!(UNAVAILABLE.len() < 1024);

    let expired = state.create("<h1>Expiring</h1>".into(), now).unwrap();
    let stale = response(state.read(&expired.token, now + TTL));
    assert_eq!(stale.status(), 404);
    assert_eq!(stale.body(), UNAVAILABLE.as_bytes());
}
#[test]
fn not_found_body_never_echoes_request_derived_data() {
    let state = ArtifactPreviewState::default();
    let now = Instant::now();
    let first = "a".repeat(64);
    let second = "b".repeat(64);
    let one = response(state.read(&first, now));
    let two = response(state.read(&second, now));
    assert_eq!(one.body(), two.body());
    assert_eq!(one.body(), UNAVAILABLE.as_bytes());
    assert!(!UNAVAILABLE.contains(&first));
    assert!(!UNAVAILABLE.contains(&second));
    assert!(!UNAVAILABLE.contains("://"));
}
#[test]
fn requests_reject_unknown_fields() {
    assert!(serde_json::from_str::<CreateRequest>(r#"{"html":"x","url":"evil"}"#).is_err());
    assert!(serde_json::from_str::<RevokeRequest>(r#"{"token":"x","owner":"foreign"}"#).is_err());
}
#[test]
fn bundle_routes_are_exact_token_paths_and_allow_asset_cache_keys() {
    let token = "c".repeat(64);
    let route = format!("{SCHEME}://localhost/{token}/report/main.css?v=123");
    let request = Request::builder().uri(route).body(vec![]).unwrap();
    assert_eq!(
        bundle_route(&request),
        Some((token.as_str(), "report/main.css".into()))
    );
    for path in [
        "../secret.css",
        "%2e%2e/secret.css",
        "report%2fsecret.css",
        ".env",
        "report//x.js",
    ] {
        let request = Request::builder()
            .uri(format!("{SCHEME}://localhost/{token}/{path}"))
            .body(vec![])
            .unwrap();
        assert!(bundle_route(&request).is_none());
    }
}
