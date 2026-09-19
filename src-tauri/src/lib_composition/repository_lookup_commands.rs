use super::repository_lookup::{
    RepositoryHostsSnapshot, RepositoryLookupOutcome, RepositoryLookupRequest,
    RepositoryLookupRequestWire, RepositoryLookupService,
};
use crate::run_blocking_command;
use std::sync::Arc;
use tauri::State;

const INVALID_REQUEST: &str = "The repository lookup request was rejected.";

#[tauri::command]
pub(crate) async fn repository_lookup_hosts(
    service: State<'_, Arc<RepositoryLookupService>>,
) -> Result<RepositoryHostsSnapshot, String> {
    let service = Arc::clone(&service);
    run_blocking_command(move || Ok(service.hosts())).await
}

#[tauri::command]
pub(crate) async fn repository_lookup(
    request: RepositoryLookupRequestWire,
    service: State<'_, Arc<RepositoryLookupService>>,
) -> Result<RepositoryLookupOutcome, String> {
    let Some(request) = RepositoryLookupRequest::validate(&request) else {
        return Err(INVALID_REQUEST.to_string());
    };
    let service = Arc::clone(&service);
    run_blocking_command(move || Ok(service.lookup(request))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lookup_requests_reject_unknown_fields_and_unknown_providers() {
        let request = serde_json::from_value::<RepositoryLookupRequestWire>(json!({
            "provider": "github",
            "host": "github.com",
            "path": "acme/storefront-api"
        }))
        .expect("deserialize request");

        assert!(RepositoryLookupRequest::validate(&request).is_some());
        assert!(
            serde_json::from_value::<RepositoryLookupRequestWire>(json!({
                "provider": "bitbucket",
                "host": "github.com",
                "path": "acme/storefront-api"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<RepositoryLookupRequestWire>(json!({
                "provider": "github",
                "host": "github.com",
                "path": "acme/storefront-api",
                "hostname": "github.com"
            }))
            .is_err()
        );
    }
}
