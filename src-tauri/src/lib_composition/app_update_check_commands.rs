use serde::Serialize;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;

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
}

#[tauri::command]
pub(crate) async fn app_update_check(webview: Webview) -> Result<AppUpdateCheckOutcome, String> {
    let updater = webview
        .updater_builder()
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
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
    use url::Url;

    const CONFIGURED_UPDATE_ENDPOINT: &str =
        "https://github.com/MatusMockor/codevo-editor/releases/download/beta/latest.json";

    #[test]
    fn the_single_update_source_is_the_configured_beta_manifest() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("config");
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            json!([CONFIGURED_UPDATE_ENDPOINT])
        );
        let url = Url::parse(CONFIGURED_UPDATE_ENDPOINT).expect("url");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert!(url.path().ends_with("/latest.json"));
    }

    #[test]
    fn outcomes_serialize_as_a_closed_tagged_union_without_a_channel() {
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
    }
}
