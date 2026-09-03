use super::*;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicU64, Ordering};

static NONCE: AtomicU64 = AtomicU64::new(0);

fn executable(body: &str) -> PathBuf {
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let path = env::temp_dir().join(format!(
        "codevo-provider-process-{}-{nonce}",
        std::process::id()
    ));
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
    }
    path
}

fn effective_path() -> String {
    env::var("PATH").expect("test PATH")
}

#[test]
fn executable_validation_does_not_mutate_the_shared_descriptor_cursor() {
    let cli = executable("exit 0");
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let mut cursor_observer = identity.descriptor.try_clone().expect("descriptor clone");
    cursor_observer
        .seek(SeekFrom::Start(3))
        .expect("set shared cursor");

    assert!(identity.retained_is_current());
    assert_eq!(cursor_observer.stream_position().expect("cursor"), 3);

    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn concurrent_executable_validations_do_not_interfere() {
    let cli = executable(&format!("# {}\nexit 0", "x".repeat(8 * 1024 * 1024)));
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let validations = (0..8)
        .map(|_| {
            let identity = identity.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                identity.retained_is_current()
            })
        })
        .collect::<Vec<_>>();

    assert!(validations
        .into_iter()
        .all(|validation| validation.join().expect("validation thread")));

    fs::remove_file(cli).expect("cleanup");
}

fn provider_plan(
    cli_path: &Path,
    intent: AgentProviderProcessIntent,
) -> Result<AgentProviderProcessPlan, String> {
    let path = effective_path();
    let identity = executable_identity_path_with_effective_path(cli_path, &path)?;
    AgentProviderProcessPlan::provider_owned_with_effective_path(identity, intent, &path)
}

fn package_manager_plan(
    identity: ExecutableIdentity,
    intent: AgentProviderProcessIntent,
) -> Result<AgentProviderProcessPlan, String> {
    AgentProviderProcessPlan::package_manager_with_effective_path(
        identity,
        intent,
        &effective_path(),
    )
}

fn sign_in_recipe(
    cli_path: &Path,
    provider: AgentCliInvocation,
) -> Result<AgentProviderSignInRecipe, String> {
    let path = effective_path();
    let identity = executable_identity_path_with_effective_path(cli_path, &path)?;
    AgentProviderSignInRecipe::from_resolved(identity, provider, &path)
}

#[test]
fn semantic_plans_have_fixed_arguments() {
    let cli = executable("exit 0");
    let plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::ClaudeCode),
    )
    .expect("plan");
    assert_eq!(plan.args(), ["auth", "status", "--json"]);
    let manager = executable_identity(cli.to_str().expect("path")).expect("manager identity");
    let npm = package_manager_plan(
        manager.clone(),
        AgentProviderProcessIntent::NpmAvailableVersion(AgentCliInvocation::CodexExec),
    )
    .expect("npm plan");
    assert_eq!(npm.args(), ["view", "@openai/codex", "version", "--json"]);
    let caskroom = package_manager_plan(
        manager.clone(),
        AgentProviderProcessIntent::BrewCaskroom(AgentCliInvocation::ClaudeCode),
    )
    .expect("caskroom plan");
    assert_eq!(caskroom.args(), ["--caskroom", "claude-code"]);
    let outdated = package_manager_plan(
        manager.clone(),
        AgentProviderProcessIntent::BrewOutdated(AgentCliInvocation::CodexExec),
    )
    .expect("outdated plan");
    assert_eq!(
        outdated.args(),
        ["outdated", "--json=v2", "--cask", "codex"]
    );
    let update = package_manager_plan(
        manager,
        AgentProviderProcessIntent::BrewUpdate(AgentCliInvocation::ClaudeCode),
    )
    .expect("update plan");
    assert_eq!(update.args(), ["upgrade", "--cask", "claude-code"]);
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn package_manager_resolution_uses_only_the_captured_effective_path() {
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let directory = env::temp_dir().join(format!(
        "codevo-provider-manager-path-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).expect("manager directory");
    let npm = directory.join("npm");
    fs::write(&npm, "#!/bin/sh\nexit 0\n").expect("npm fixture");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm, fs::Permissions::from_mode(0o755)).expect("npm mode");
    }
    let effective_path = directory.to_string_lossy().into_owned();

    let resolved = resolve_package_manager_on_path("npm", &effective_path).expect("npm");

    assert_eq!(
        resolved.canonical_path,
        fs::canonicalize(&npm).expect("canonical npm")
    );
    assert!(resolve_package_manager_on_path("brew", "/missing").is_none());
    assert!(resolve_package_manager_on_path("npm", "relative:/usr/bin").is_none());
    fs::remove_dir_all(directory).expect("manager cleanup");
}

#[test]
fn oversized_host_environment_values_are_omitted_from_process_plans() {
    assert_eq!(
        bounded_environment_entry(
            "CODEX_HOME".to_string(),
            "x".repeat(MAX_PROVIDER_ENV_VALUE_BYTES + 1),
        ),
        None
    );
    assert_eq!(
        bounded_environment_entry("CODEX_HOME".to_string(), "/bounded".to_string()),
        Some(("CODEX_HOME".to_string(), "/bounded".to_string()))
    );
}

#[test]
fn sign_in_recipes_have_exact_provider_argv_without_a_shell_command() {
    let cli = executable("exit 0");
    let claude = sign_in_recipe(&cli, AgentCliInvocation::ClaudeCode).expect("claude recipe");
    let codex = sign_in_recipe(&cli, AgentCliInvocation::CodexExec).expect("codex recipe");
    let canonical_cli = fs::canonicalize(&cli).expect("canonical fake provider");
    assert_eq!(
        claude.args(),
        [canonical_cli.to_string_lossy().as_ref(), "auth", "login"]
    );
    assert_eq!(
        codex.args(),
        [canonical_cli.to_string_lossy().as_ref(), "login"]
    );
    assert_eq!(claude.program(), Path::new("/bin/sh"));
    assert!(!claude.args().iter().any(|argument| argument == "-c"));
    assert!(claude.env().iter().all(|(key, _)| {
        crate::agent_task_spawner::AGENT_TASK_INHERITED_ENV.contains(&key.as_str())
            || matches!(
                key.as_str(),
                "CODEX_HOME" | "CLAUDE_CONFIG_DIR" | "XDG_CONFIG_HOME" | "XDG_DATA_HOME"
            )
    }));
    assert!(claude
        .env()
        .iter()
        .all(|(_, value)| value.len() <= MAX_PROVIDER_ENV_VALUE_BYTES));
    fs::remove_file(cli).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn sign_in_recipe_refuses_a_descriptor_path_swap_before_pty_spawn() {
    use std::os::unix::fs::PermissionsExt;

    let cli = executable("exit 0");
    let recipe = sign_in_recipe(&cli, AgentCliInvocation::CodexExec).expect("recipe");
    let retained = cli.with_extension("retained");
    fs::rename(&cli, &retained).expect("retain captured executable");
    fs::write(&cli, "#!/bin/sh\nexit 0\n").expect("replacement");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("replacement mode");

    assert!(!recipe.identity_is_current());
    fs::remove_file(cli).expect("replacement cleanup");
    fs::remove_file(retained).expect("captured cleanup");
}

#[test]
fn output_is_bounded_and_nonzero_is_explicit() {
    let cli = executable("head -c 32000 /dev/zero; exit 3");
    let plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
    )
    .expect("plan");
    let AgentProviderProcessFailure::Exited { stdout, .. } =
        execute_agent_provider_plan(&plan).expect_err("nonzero")
    else {
        panic!("wrong failure");
    };
    assert!(stdout.len() <= MAX_AGENT_PROVIDER_OUTPUT_BYTES);
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn combined_update_output_limit_is_a_hard_failure() {
    let cli = executable("head -c 700000 /dev/zero & head -c 700000 /dev/zero >&2 & wait");
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let plan = package_manager_plan(
        identity,
        AgentProviderProcessIntent::NpmUpdate {
            provider: AgentCliInvocation::CodexExec,
            version: "0.150.1".to_string(),
        },
    )
    .expect("plan");
    let AgentProviderProcessFailure::OutputLimitExceeded { stdout, stderr } =
        execute_agent_provider_update_plan_cancellable(&plan, || false, || true)
            .expect_err("output cap")
    else {
        panic!("wrong failure");
    };
    assert!(stdout.len() + stderr.len() <= UPDATE_OUTPUT_BYTES);
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn generic_executor_refuses_update_plans_before_spawn() {
    let marker = env::temp_dir().join(format!(
        "codevo-provider-generic-update-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let plan = package_manager_plan(
        identity,
        AgentProviderProcessIntent::NpmUpdate {
            provider: AgentCliInvocation::CodexExec,
            version: "0.150.1".to_string(),
        },
    )
    .expect("plan");

    assert!(matches!(
        execute_agent_provider_plan(&plan),
        Err(AgentProviderProcessFailure::Uncertain(message))
            if message == "Provider update plan requires spawn authorization."
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn update_executor_refuses_probe_plans_before_spawn() {
    let marker = env::temp_dir().join(format!(
        "codevo-provider-update-probe-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
    let plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
    )
    .expect("plan");

    assert!(matches!(
        execute_agent_provider_update_plan_cancellable(&plan, || false, || true),
        Err(AgentProviderProcessFailure::Uncertain(message))
            if message == "Provider probe plan cannot use update spawn authorization."
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn cancellation_while_update_spawn_authorization_is_blocked_prevents_spawn() {
    let marker = env::temp_dir().join(format!(
        "codevo-provider-blocked-update-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let plan = package_manager_plan(
        identity,
        AgentProviderProcessIntent::NpmUpdate {
            provider: AgentCliInvocation::CodexExec,
            version: "0.150.1".to_string(),
        },
    )
    .expect("plan");
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = Arc::clone(&cancelled);
    let (entered_sender, entered_receiver) = std::sync::mpsc::channel();
    let (release_sender, release_receiver) = std::sync::mpsc::channel();
    let worker = thread::spawn(move || {
        execute_agent_provider_update_plan_cancellable(
            &plan,
            || worker_cancelled.load(Ordering::Acquire),
            || {
                entered_sender.send(()).expect("authorization entered");
                release_receiver.recv().expect("authorization released");
                true
            },
        )
    });
    entered_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("authorization callback");
    cancelled.store(true, Ordering::Release);
    release_sender.send(()).expect("release authorization");

    assert!(matches!(
        worker.join().expect("update worker"),
        Err(AgentProviderProcessFailure::Uncertain(message))
            if message == "Provider operation was cancelled."
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn deadline_expiry_while_update_spawn_authorization_is_blocked_prevents_spawn() {
    let marker = env::temp_dir().join(format!(
        "codevo-provider-blocked-deadline-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let mut plan = package_manager_plan(
        identity,
        AgentProviderProcessIntent::NpmUpdate {
            provider: AgentCliInvocation::CodexExec,
            version: "0.150.1".to_string(),
        },
    )
    .expect("plan");
    plan.timeout = Duration::from_millis(20);

    assert!(matches!(
        execute_agent_provider_update_plan_cancellable(
            &plan,
            || false,
            || {
                thread::sleep(Duration::from_millis(50));
                true
            },
        ),
        Err(AgentProviderProcessFailure::TimedOut { .. })
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn installer_replacement_during_spawn_authorization_is_rejected_before_spawn() {
    use std::os::unix::fs::PermissionsExt;

    let marker = env::temp_dir().join(format!(
        "codevo-provider-installer-swap-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
    let retained = cli.with_extension("retained");
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let plan = package_manager_plan(
        identity,
        AgentProviderProcessIntent::NpmUpdate {
            provider: AgentCliInvocation::CodexExec,
            version: "0.150.1".to_string(),
        },
    )
    .expect("plan");
    let swapped_cli = cli.clone();
    let retained_cli = retained.clone();
    let replacement_marker = marker.clone();

    assert!(matches!(
        execute_agent_provider_update_plan_cancellable(
            &plan,
            || false,
            move || {
                fs::rename(&swapped_cli, &retained_cli).expect("retain installer");
                fs::write(
                    &swapped_cli,
                    format!(
                        "#!/bin/sh\ntouch '{}'; exit 0\n",
                        replacement_marker.display()
                    ),
                )
                .expect("replacement installer");
                fs::set_permissions(&swapped_cli, fs::Permissions::from_mode(0o755))
                    .expect("replacement permissions");
                true
            },
        ),
        Err(AgentProviderProcessFailure::Uncertain(message))
            if message == "Provider executable identity changed before launch."
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("replacement cleanup");
    fs::remove_file(retained).expect("retained cleanup");
}

#[cfg(unix)]
#[test]
fn interpreter_replacement_during_spawn_authorization_is_rejected_before_spawn() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let interpreter = env::temp_dir().join(format!(
        "codevo-provider-interpreter-{}-{nonce}",
        std::process::id()
    ));
    fs::copy("/bin/sh", &interpreter).expect("captured interpreter");
    fs::set_permissions(&interpreter, fs::Permissions::from_mode(0o755))
        .expect("interpreter permissions");
    let marker = env::temp_dir().join(format!(
        "codevo-provider-interpreter-swap-marker-{}-{nonce}",
        std::process::id()
    ));
    let cli = executable("exit 0");
    fs::write(
        &cli,
        format!(
            "#!{}\ntouch '{}'; exit 0\n",
            interpreter.display(),
            marker.display()
        ),
    )
    .expect("provider with captured interpreter");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("provider permissions");
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let plan = package_manager_plan(
        identity,
        AgentProviderProcessIntent::NpmUpdate {
            provider: AgentCliInvocation::CodexExec,
            version: "0.150.1".to_string(),
        },
    )
    .expect("plan");
    let retained_interpreter = interpreter.with_extension("retained");
    let swapped_interpreter = interpreter.clone();
    let retained_for_callback = retained_interpreter.clone();

    assert!(matches!(
        execute_agent_provider_update_plan_cancellable(
            &plan,
            || false,
            move || {
                fs::rename(&swapped_interpreter, &retained_for_callback)
                    .expect("retain interpreter");
                fs::copy("/bin/sh", &swapped_interpreter).expect("replacement interpreter");
                fs::set_permissions(
                    &swapped_interpreter,
                    fs::Permissions::from_mode(0o755),
                )
                .expect("replacement interpreter permissions");
                true
            },
        ),
        Err(AgentProviderProcessFailure::Uncertain(message))
            if message == "Provider executable identity changed before launch."
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("provider cleanup");
    fs::remove_file(interpreter).expect("replacement interpreter cleanup");
    fs::remove_file(retained_interpreter).expect("retained interpreter cleanup");
}

#[test]
fn timeout_kills_the_owned_process_group() {
    let cli = executable("sleep 30 & wait");
    let mut plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
    )
    .expect("plan");
    plan.timeout = Duration::from_millis(100);
    assert!(matches!(
        execute_agent_provider_plan(&plan),
        Err(AgentProviderProcessFailure::TimedOut { .. })
    ));
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn validation_uses_the_process_deadline_before_spawn() {
    let marker = env::temp_dir().join(format!(
        "codevo-provider-deadline-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let cli = executable(&format!("touch '{}'; exit 0", marker.display()));
    let mut plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
    )
    .expect("plan");
    plan.timeout = Duration::ZERO;
    assert!(matches!(
        execute_agent_provider_plan(&plan),
        Err(AgentProviderProcessFailure::TimedOut { .. })
    ));
    assert!(!marker.exists());
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn cancellation_during_digest_validation_prevents_spawn() {
    let marker = env::temp_dir().join(format!(
        "codevo-provider-cancel-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let body = format!(
        "touch '{}'; exit 0\n{}",
        marker.display(),
        "\n".repeat(128 * 1024)
    );
    let cli = executable(&body);
    let plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
    )
    .expect("plan");
    let polls = AtomicUsize::new(0);
    let result = execute_agent_provider_plan_cancellable(&plan, || {
        polls.fetch_add(1, Ordering::AcqRel) >= 3
    });
    assert!(matches!(
        result,
        Err(AgentProviderProcessFailure::Uncertain(message))
            if message == "Provider operation was cancelled."
    ));
    assert!(polls.load(Ordering::Acquire) >= 4);
    assert!(!marker.exists());
    fs::remove_file(cli).expect("cleanup");
}

#[test]
fn owner_cancellation_reaps_the_process_group() {
    let cli = executable("sleep 30 & wait");
    let plan = provider_plan(
        &cli,
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::CodexExec),
    )
    .expect("plan");
    let cancelled = Arc::new(AtomicBool::new(false));
    let setter = Arc::clone(&cancelled);
    let thread = thread::spawn(move || {
        thread::sleep(Duration::from_millis(50));
        setter.store(true, Ordering::Release);
    });
    assert!(matches!(
        execute_agent_provider_plan_cancellable(&plan, || cancelled.load(Ordering::Acquire)),
        Err(AgentProviderProcessFailure::Uncertain(_))
    ));
    thread.join().expect("canceller");
    fs::remove_file(cli).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn final_spawn_revalidation_rejects_a_captured_script_path_swap() {
    use std::os::unix::fs::PermissionsExt;

    let cli = executable("printf captured");
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let mut bound = identity.bound_command().expect("bound command");
    let replacement = cli.with_extension("replacement");
    let swapped_cli = cli.clone();
    let retained = replacement.clone();
    bound.before_artifact_validation = Some(Box::new(move || {
        fs::rename(&swapped_cli, &retained).expect("retain original");
        fs::write(&swapped_cli, "#!/bin/sh\nprintf replaced\n").expect("replacement");
        fs::set_permissions(&swapped_cli, fs::Permissions::from_mode(0o755)).expect("permissions");
    }));
    assert!(matches!(
        bound.spawn(),
        Err(BoundExecutableSpawnFailure::IdentityChanged)
    ));
    fs::remove_file(cli).expect("replacement cleanup");
    fs::remove_file(replacement).expect("original cleanup");
}

#[cfg(unix)]
#[test]
fn env_shebang_uses_the_captured_interpreter_under_a_hostile_path() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = env::temp_dir().join(format!(
        "codevo-provider-hostile-path-{}-{nonce}",
        std::process::id()
    ));
    let hostile = fixture.join("hostile");
    fs::create_dir_all(&hostile).expect("hostile path");
    let cli = fixture.join("provider");
    fs::write(&cli, "#!/usr/bin/env sh\nprintf captured\n").expect("provider");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("provider mode");
    let hostile_shell = hostile.join("sh");
    fs::write(&hostile_shell, "#!/bin/sh\nprintf hostile\n").expect("hostile shell");
    fs::set_permissions(&hostile_shell, fs::Permissions::from_mode(0o755)).expect("hostile mode");
    let identity = executable_identity(cli.to_str().expect("path")).expect("identity");
    let mut bound = identity.bound_command().expect("bound command");
    let output = bound
        .command_mut()
        .env_clear()
        .env("PATH", &hostile)
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn captured interpreter")
        .wait_with_output()
        .expect("captured output");
    assert!(output.status.success());
    assert_eq!(output.stdout, b"captured");
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn effective_path_resolves_env_shebang_and_is_injected_into_sign_in() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = env::temp_dir().join(format!(
        "codevo-provider-effective-path-{}-{nonce}",
        std::process::id()
    ));
    let detected_bin = fixture.join("detected-bin");
    fs::create_dir_all(&detected_bin).expect("detected bin");
    let node = detected_bin.join("node");
    std::os::unix::fs::symlink("/bin/sh", &node).expect("node shim");
    let cli = fixture.join("provider");
    fs::write(&cli, "#!/usr/bin/env node\nprintf captured\n").expect("provider");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("provider mode");
    let effective_path = detected_bin.to_string_lossy().into_owned();

    let identity = executable_identity_path_with_effective_path(&cli, &effective_path)
        .expect("resolved identity");
    let recipe = AgentProviderSignInRecipe::from_resolved(
        identity.clone(),
        AgentCliInvocation::CodexExec,
        &effective_path,
    )
    .expect("sign-in recipe");
    let mut bound = identity.bound_command().expect("bound command");
    let output = bound
        .command_mut()
        .env_clear()
        .env("PATH", "/hostile")
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn captured node")
        .wait_with_output()
        .expect("captured output");

    assert!(output.status.success());
    assert_eq!(output.stdout, b"captured");
    assert_eq!(
        recipe
            .env()
            .iter()
            .find(|(key, _)| key == "PATH")
            .map(|(_, value)| value.as_str()),
        Some(effective_path.as_str())
    );
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn unsupported_shebang_arguments_fail_closed() {
    let cli = executable("exit 0");
    fs::write(&cli, "#!/usr/bin/env -S sh\nexit 0\n").expect("unsupported script");
    assert_eq!(
        executable_identity(cli.to_str().expect("path")).expect_err("unsupported"),
        "Provider script interpreter is unsupported."
    );
    fs::remove_file(cli).expect("cleanup");
}
