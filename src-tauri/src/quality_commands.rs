use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use crate::{artisan, eslint, php_test_run, phpstan, pint, prettier};
#[path = "php_test_coverage_commands.rs"]
mod php_test_coverage_commands;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) async fn run_php_test_coverage_clover(
    workspace_id: WorkspaceId,
    root_path: String,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<php_test_run::coverage::PhpCloverCoverageResponse, String> {
    php_test_coverage_commands::run_php_test_coverage_clover(
        workspace_id,
        root_path,
        app,
        trust,
        registry,
    )
    .await
}

#[tauri::command]
pub(crate) async fn run_eslint_analysis(
    root_path: String,
    binary_path: Option<String>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    processes: State<'_, Arc<eslint::EslintProcessRegistry>>,
) -> Result<eslint::EslintAnalysisResponse, String> {
    run_eslint_analysis_with_trust(root_path, binary_path, &trust, processes.inner().clone()).await
}

#[tauri::command]
pub(crate) async fn run_eslint_document_analysis(
    root_path: String,
    file_path: String,
    content: String,
    binary_path: Option<String>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    processes: State<'_, Arc<eslint::EslintProcessRegistry>>,
) -> Result<eslint::EslintAnalysisResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(eslint::EslintAnalysisResponse::Unavailable {
            message: Some("Trust this workspace to run ESLint.".to_string()),
        });
    }
    eslint::run_eslint_document_analysis(
        root_path,
        file_path,
        content,
        binary_path,
        processes.inner().clone(),
    )
    .await
}

pub(crate) async fn run_eslint_analysis_with_trust(
    root_path: String,
    binary_path: Option<String>,
    trust: &Mutex<WorkspaceTrustService>,
    processes: Arc<eslint::EslintProcessRegistry>,
) -> Result<eslint::EslintAnalysisResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(eslint::EslintAnalysisResponse::Unavailable {
            message: Some("Trust this workspace to run ESLint.".to_string()),
        });
    }
    eslint::run_eslint_analysis(root_path, binary_path, processes).await
}

#[tauri::command]
pub(crate) async fn run_phpstan_analysis(
    root_path: String,
    binary_path: Option<String>,
    config_path: Option<String>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<phpstan::PhpStanAnalysisResponse, String> {
    run_phpstan_analysis_with_trust(root_path, binary_path, config_path, &trust).await
}

pub(crate) async fn run_phpstan_analysis_with_trust(
    root_path: String,
    binary_path: Option<String>,
    config_path: Option<String>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<phpstan::PhpStanAnalysisResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(phpstan::PhpStanAnalysisResponse::Unavailable {
            message: Some("Trust this workspace to run PHPStan.".to_string()),
        });
    }
    phpstan::run_phpstan_analysis(root_path, binary_path, config_path).await
}

#[tauri::command]
pub(crate) async fn run_pint_format(
    root_path: String,
    relative_path: Option<String>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<pint::PintFormatResponse, String> {
    run_pint_format_with_trust(root_path, relative_path, &trust).await
}

pub(crate) async fn run_pint_format_with_trust(
    root_path: String,
    relative_path: Option<String>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<pint::PintFormatResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(pint::PintFormatResponse::Unavailable {
            message: Some("Trust this workspace to run Pint.".to_string()),
        });
    }
    pint::run_pint_format(root_path, relative_path).await
}

#[tauri::command]
pub(crate) async fn run_prettier_format(
    root_path: String,
    relative_path: String,
    content: String,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<prettier::PrettierFormatResponse, String> {
    run_prettier_format_with_trust(root_path, relative_path, content, &trust).await
}

pub(crate) async fn run_prettier_format_with_trust(
    root_path: String,
    relative_path: String,
    content: String,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<prettier::PrettierFormatResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(prettier::PrettierFormatResponse::Unavailable {
            message: Some("Trust this workspace to run Prettier.".to_string()),
        });
    }
    prettier::run_prettier_format(root_path, relative_path, content).await
}

#[tauri::command]
pub(crate) async fn run_artisan_route_list(
    root_path: String,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<artisan::ArtisanRoutesResponse, String> {
    run_artisan_route_list_with_trust(root_path, &trust).await
}

pub(crate) async fn run_artisan_route_list_with_trust(
    root_path: String,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<artisan::ArtisanRoutesResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(artisan::ArtisanRoutesResponse::Unavailable {
            message: "Trust this workspace to inspect Artisan routes.".to_string(),
        });
    }
    artisan::run_artisan_route_list(root_path).await
}

#[tauri::command]
pub(crate) async fn run_php_tests_junit(
    root_path: String,
    filter: Option<String>,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<php_test_run::PhpTestRunResponse, String> {
    let app_data_base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    run_php_tests_junit_with_trust(root_path, app_data_base, filter, &trust).await
}

pub(crate) async fn run_php_tests_junit_with_trust(
    root_path: String,
    app_data_base: PathBuf,
    filter: Option<String>,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<php_test_run::PhpTestRunResponse, String> {
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .get(&root_path)
        .trusted;
    if !trusted {
        return Ok(php_test_run::PhpTestRunResponse::Unavailable {
            message: "Trust this workspace to run PHP tests.".to_string(),
        });
    }
    php_test_run::run_php_tests(root_path, app_data_base, filter).await
}
