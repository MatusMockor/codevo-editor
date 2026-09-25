use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use url::Url;

pub(crate) const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/MatusMockor/codevo-editor/releases/latest/download/latest.json";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AppUpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppUpdateCheckRequest {
    channel: AppUpdateChannel,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum AppUpdateCheckOutcome {
    Available(AppUpdateMetadata),
    UpToDate,
    NoRelease { channel: AppUpdateChannel },
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum AppUpdateEndpoints {
    Configured,
    Override(Vec<Url>),
}

pub(crate) fn endpoints_for(channel: AppUpdateChannel) -> Result<AppUpdateEndpoints, String> {
    match channel {
        AppUpdateChannel::Beta => Ok(AppUpdateEndpoints::Configured),
        AppUpdateChannel::Stable => Url::parse(STABLE_UPDATE_ENDPOINT)
            .map(|url| AppUpdateEndpoints::Override(vec![url]))
            .map_err(|_| "The stable update endpoint is invalid.".to_string()),
    }
}

pub(crate) fn missing_release_outcome(
    channel: AppUpdateChannel,
    error: &tauri_plugin_updater::Error,
) -> Option<AppUpdateCheckOutcome> {
    if channel != AppUpdateChannel::Stable {
        return None;
    }
    if !matches!(error, tauri_plugin_updater::Error::ReleaseNotFound) {
        return None;
    }
    Some(AppUpdateCheckOutcome::NoRelease { channel })
}

#[tauri::command]
pub(crate) async fn app_update_check(
    webview: Webview,
    request: AppUpdateCheckRequest,
) -> Result<AppUpdateCheckOutcome, String> {
    let mut builder = webview.updater_builder();
    if let AppUpdateEndpoints::Override(endpoints) = endpoints_for(request.channel)? {
        builder = builder
            .endpoints(endpoints)
            .map_err(|error| error.to_string())?;
    }
    let updater = builder.build().map_err(|error| error.to_string())?;
    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            return missing_release_outcome(request.channel, &error)
                .ok_or_else(|| error.to_string());
        }
    };
    let Some(update) = update else {
        return Ok(AppUpdateCheckOutcome::UpToDate);
    };
    let date = update
        .date
        .map(|date| date.format(&Rfc3339))
        .transpose()
        .map_err(|_| "The update release date is invalid.".to_string())?;
    let metadata = AppUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(AppUpdateCheckOutcome::Available(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const BETA_UPDATE_ENDPOINT: &str =
        "https://github.com/MatusMockor/codevo-editor/releases/download/beta/latest.json";

    fn request(value: serde_json::Value) -> Result<AppUpdateCheckRequest, serde_json::Error> {
        serde_json::from_value(value)
    }

    #[test]
    fn channel_wire_is_closed_and_lowercase() {
        assert_eq!(
            request(json!({ "channel": "stable" }))
                .expect("stable")
                .channel,
            AppUpdateChannel::Stable
        );
        assert_eq!(
            request(json!({ "channel": "beta" })).expect("beta").channel,
            AppUpdateChannel::Beta
        );
        assert!(request(json!({ "channel": "Stable" })).is_err());
        assert!(request(json!({ "channel": "nightly" })).is_err());
        assert!(request(json!({ "channel": "beta", "endpoint": "https://example.com" })).is_err());
        assert!(request(json!({})).is_err());
    }

    #[test]
    fn beta_keeps_the_configured_endpoint_and_stable_overrides_it() {
        assert_eq!(
            endpoints_for(AppUpdateChannel::Beta).expect("beta"),
            AppUpdateEndpoints::Configured
        );
        assert_eq!(
            endpoints_for(AppUpdateChannel::Stable).expect("stable"),
            AppUpdateEndpoints::Override(vec![Url::parse(STABLE_UPDATE_ENDPOINT).expect("url")])
        );
    }

    #[test]
    fn configured_updater_endpoint_is_the_beta_manifest() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("config");
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            json!([BETA_UPDATE_ENDPOINT])
        );
    }

    #[test]
    fn both_endpoints_are_https_github_release_manifests() {
        for endpoint in [STABLE_UPDATE_ENDPOINT, BETA_UPDATE_ENDPOINT] {
            let url = Url::parse(endpoint).expect("url");
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some("github.com"));
            assert!(url.path().ends_with("/latest.json"));
        }
    }

    #[test]
    fn a_missing_stable_release_is_a_distinct_no_release_outcome() {
        assert_eq!(
            missing_release_outcome(
                AppUpdateChannel::Stable,
                &tauri_plugin_updater::Error::ReleaseNotFound
            ),
            Some(AppUpdateCheckOutcome::NoRelease {
                channel: AppUpdateChannel::Stable
            })
        );
        assert_eq!(
            missing_release_outcome(
                AppUpdateChannel::Beta,
                &tauri_plugin_updater::Error::ReleaseNotFound
            ),
            None
        );
        assert_eq!(
            missing_release_outcome(
                AppUpdateChannel::Stable,
                &tauri_plugin_updater::Error::EmptyEndpoints
            ),
            None
        );
    }

    #[test]
    fn outcomes_serialize_as_a_closed_tagged_union() {
        let metadata = AppUpdateMetadata {
            rid: 7,
            current_version: "0.2.0-beta.72".to_string(),
            version: "0.2.0".to_string(),
            date: None,
            body: Some("Notes".to_string()),
            raw_json: json!({ "version": "0.2.0" }),
        };
        assert_eq!(
            serde_json::to_value(AppUpdateCheckOutcome::Available(metadata)).expect("json"),
            json!({
                "kind": "available",
                "rid": 7,
                "currentVersion": "0.2.0-beta.72",
                "version": "0.2.0",
                "date": null,
                "body": "Notes",
                "rawJson": { "version": "0.2.0" }
            })
        );
        assert_eq!(
            serde_json::to_value(AppUpdateCheckOutcome::UpToDate).expect("json"),
            json!({ "kind": "upToDate" })
        );
        assert_eq!(
            serde_json::to_value(AppUpdateCheckOutcome::NoRelease {
                channel: AppUpdateChannel::Stable
            })
            .expect("json"),
            json!({ "kind": "noRelease", "channel": "stable" })
        );
    }
}
