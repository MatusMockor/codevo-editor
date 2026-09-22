use super::super::plan::CliPlan;
use super::super::search::parse_page;
use super::super::search_wire::{
    RepositorySearchOutcome, RepositorySearchRequest, RepositorySearchRequestWire,
};
use super::super::wire::RepositoryLookupOutcome;
use super::fake_cli::FakeCliDirectory;
use serde_json::json;
fn request(provider: &str, host: &str, query: &str, page: u8) -> RepositorySearchRequest {
    let wire = serde_json::from_value::<RepositorySearchRequestWire>(
        json!({"provider":provider,"host":host,"query":query,"page":page}),
    )
    .unwrap();
    RepositorySearchRequest::validate(&wire).unwrap()
}
fn item(index: usize) -> serde_json::Value {
    json!({"full_name":format!("org/crm{index}"),"html_url":format!("https://github.com/org/crm{index}"),"private":true,"default_branch":"main"})
}
#[test]
fn validates_search_before_process_planning() {
    for query in [
        "",
        "--flag",
        "a..b",
        "crm&token=x",
        "user:me",
        "a\n",
        " crm",
        "é",
    ] {
        let wire = serde_json::from_value::<RepositorySearchRequestWire>(
            json!({"provider":"github","host":"github.com","query":query,"page":1}),
        )
        .unwrap();
        assert!(
            RepositorySearchRequest::validate(&wire).is_none(),
            "{query}"
        );
    }
    assert!(serde_json::from_value::<RepositorySearchRequestWire>(
        json!({"provider":"github","host":"github.com","query":"crm","page":1,"args":[]})
    )
    .is_err());
    for page in [0, 11] {
        let wire = serde_json::from_value::<RepositorySearchRequestWire>(
            json!({"provider":"github","host":"github.com","query":"crm","page":page}),
        )
        .unwrap();
        assert!(RepositorySearchRequest::validate(&wire).is_none());
    }
}
#[test]
fn plans_encoded_queries_as_one_argument_without_shell_or_unbounded_pagination() {
    let plan = CliPlan::RepositorySearch {
        request: request("github", "github.com", "acme/crm one", 2),
    };
    assert_eq!(
        plan.argv(),
        [
            "api",
            "--hostname",
            "github.com",
            "search/repositories?q=acme%2Fcrm%20one%20in%3Aname%20fork%3Atrue&per_page=20&page=2"
        ]
    );
    let plan = CliPlan::RepositorySearch {
        request: request("gitlab", "gitlab.example.com", "crm", 1),
    };
    assert_eq!(
        plan.argv()[3],
        "projects?membership=true&search=crm&per_page=20&page=1&order_by=id&sort=asc"
    );
}
#[test]
fn page_bounds_duplicates_foreign_urls_and_incomplete_results_fail_truthfully() {
    let request = request("github", "github.com", "crm", 10);
    let bytes = serde_json::to_vec(
        &json!({"items":[item(1)],"total_count":201,"incomplete_results":false}),
    )
    .unwrap();
    let page = parse_page(&request, &bytes).unwrap();
    assert!(page.truncated);
    assert_eq!(page.next_page, None);
    for items in [
        vec![item(1); 2],
        (0..21).map(item).collect(),
        vec![json!({"full_name":"org/crm","html_url":"https://evil.test/org/crm"})],
    ] {
        assert!(parse_page(
            &request,
            &serde_json::to_vec(
                &json!({"items":items,"total_count":201,"incomplete_results":false})
            )
            .unwrap()
        )
        .is_none());
    }
    let page = parse_page(
        &request,
        &serde_json::to_vec(&json!({"items":[],"total_count":0,"incomplete_results":true}))
            .unwrap(),
    )
    .unwrap();
    assert!(page.truncated);
}
#[test]
fn unauthorized_host_never_spawns_and_valid_search_reuses_bounded_service() {
    let directory = FakeCliDirectory::create("search");
    directory.script(
        "gh",
        "printf '%s' '{\"items\":[],\"total_count\":0,\"incomplete_results\":false}'",
    );
    let service = directory.service();
    assert!(matches!(
        service.search(request("github", "evil.test", "crm", 1)),
        RepositorySearchOutcome::Failure(RepositoryLookupOutcome::HostNotAllowed)
    ));
    assert!(matches!(
        service.search(request("github", "github.com", "crm", 1)),
        RepositorySearchOutcome::Page(_)
    ));
}

#[test]
fn search_query_echo_cannot_forge_failure_class() {
    let directory = FakeCliDirectory::create("search-echo");
    directory.script("gh", "echo 'could not search http 429' >&2; exit 1");
    let outcome = directory
        .service()
        .search(request("github", "github.com", "http 429", 1));
    assert!(matches!(
        outcome,
        RepositorySearchOutcome::Failure(RepositoryLookupOutcome::Failed {
            reason: super::super::wire::RepositoryLookupFailureReason::Unknown
        })
    ));
}

#[test]
fn replacement_search_supersedes_and_reaps_the_previous_request() {
    let directory = FakeCliDirectory::create("search-superseded");
    directory.script(
        "gh",
        &format!("touch '{}'\nsleep 20", directory.file("started").display()),
    );
    let service = directory.service();
    let first_service = std::sync::Arc::clone(&service);
    let first =
        std::thread::spawn(move || first_service.search(request("github", "github.com", "old", 1)));
    assert!(directory.await_file("started"));
    directory.advance_past_spawn_interval();
    directory.script(
        "gh",
        "printf '%s' '{\"items\":[],\"total_count\":0,\"incomplete_results\":false}'",
    );
    let second = service.search(request("github", "github.com", "new", 1));
    assert!(matches!(
        first.join().unwrap(),
        RepositorySearchOutcome::Failure(RepositoryLookupOutcome::Superseded)
    ));
    assert!(matches!(second, RepositorySearchOutcome::Page(_)));
}

#[test]
fn gitlab_search_preserves_custom_ssh_port_and_paginates_bounded_results() {
    let request = request("gitlab", "gitlab.example.com", "crm", 1);
    let values: Vec<_> = (0..20)
        .map(|index| {
            json!({
                "path_with_namespace": format!("org/crm{index}"), "visibility": "private",
                "ssh_url_to_repo": format!("ssh://git@gitlab.example.com:2222/org/crm{index}.git"),
                "http_url_to_repo": format!("https://gitlab.example.com/org/crm{index}.git")
            })
        })
        .collect();
    let page = parse_page(&request, &serde_json::to_vec(&values).unwrap()).unwrap();
    assert_eq!(page.repositories.len(), 20);
    assert_eq!(page.next_page, Some(2));
    assert!(!page.truncated);
    assert_eq!(
        page.repositories[0].ssh_url.as_deref(),
        Some("ssh://git@gitlab.example.com:2222/org/crm0.git")
    );
    let empty = parse_page(&request, b"[]").unwrap();
    assert!(empty.repositories.is_empty());
    assert_eq!(empty.next_page, None);
}
