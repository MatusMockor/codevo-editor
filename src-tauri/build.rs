use std::path::{Component, Path};

fn main() {
    validate_perf_capture_build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/node_attach_socket_owner_macos.c")
            .warnings(true)
            .compile("codevo_node_attach_socket_owner");
        println!("cargo:rerun-if-changed=native/node_attach_socket_owner_macos.c");
    }
    tauri_build::build()
}

fn validate_perf_capture_build() {
    const TOKEN_ENV: &str = "CODEVO_PERF_CAPTURE_RUN_TOKEN";
    const RESULT_PATH_ENV: &str = "CODEVO_PERF_CAPTURE_RESULT_PATH";
    const SMOKE_ENV: &str = "CODEVO_PERF_CAPTURE_SMOKE";
    const WORK_ROOT_ENV: &str = "CODEVO_PERF_CAPTURE_WORK_ROOT";
    const SHUTDOWN_PATH_ENV: &str = "CODEVO_PERF_CAPTURE_SHUTDOWN_PATH";

    println!("cargo:rerun-if-env-changed={TOKEN_ENV}");
    println!("cargo:rerun-if-env-changed={RESULT_PATH_ENV}");
    println!("cargo:rerun-if-env-changed={SMOKE_ENV}");
    println!("cargo:rerun-if-env-changed={WORK_ROOT_ENV}");
    println!("cargo:rerun-if-env-changed={SHUTDOWN_PATH_ENV}");

    if std::env::var_os("CARGO_FEATURE_PERF_CAPTURE").is_none() {
        return;
    }

    let token = std::env::var(TOKEN_ENV)
        .unwrap_or_else(|_| panic!("perf-capture requires a compile-time run token"));
    if !(32..=256).contains(&token.len()) || !token.bytes().all(|byte| byte.is_ascii_graphic()) {
        panic!("perf-capture compile-time run token is invalid");
    }

    let result_path = std::env::var(RESULT_PATH_ENV)
        .unwrap_or_else(|_| panic!("perf-capture requires a compile-time result path"));
    let result_path = Path::new(&result_path);
    if !result_path.is_absolute()
        || result_path.file_name().is_none_or(|name| name.is_empty())
        || result_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        panic!("perf-capture compile-time result path is invalid");
    }

    let smoke_mode = match std::env::var(SMOKE_ENV) {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) => "0".to_owned(),
        Err(std::env::VarError::NotUnicode(_)) => {
            panic!("perf-capture compile-time smoke mode is invalid")
        }
    };
    if smoke_mode != "0" && smoke_mode != "1" {
        panic!("perf-capture compile-time smoke mode is invalid");
    }
    println!("cargo:rustc-env={SMOKE_ENV}={smoke_mode}");

    let work_root = std::env::var(WORK_ROOT_ENV)
        .unwrap_or_else(|_| panic!("perf-capture requires a compile-time work root"));
    let work_root_path = Path::new(&work_root);
    if work_root.len() > 4 * 1024
        || work_root.chars().any(char::is_control)
        || !work_root_path.is_absolute()
        || work_root_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        panic!("perf-capture compile-time work root is invalid");
    }
    println!("cargo:rustc-env={WORK_ROOT_ENV}={work_root}");

    let shutdown_path = std::env::var(SHUTDOWN_PATH_ENV)
        .unwrap_or_else(|_| panic!("perf-capture requires a compile-time shutdown proof path"));
    let shutdown_path = Path::new(&shutdown_path);
    if !shutdown_path.is_absolute()
        || shutdown_path.file_name().is_none_or(|name| name.is_empty())
        || shutdown_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        panic!("perf-capture compile-time shutdown proof path is invalid");
    }
    println!(
        "cargo:rustc-env={SHUTDOWN_PATH_ENV}={}",
        shutdown_path.display()
    );
}
