use super::agent_launch::{
    ClaudeContextChoice, ClaudeEffortChoice, ClaudeModelChoice, ClaudePermissionMode,
    CodexExecutionMode, CodexModelChoice,
};
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static CWD_AUTHORITY_NONCE: AtomicU64 = AtomicU64::new(0);

const SESSION_ID: &str = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const CLAUDE_BASE_ARGV: [&str; 6] = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
];

fn no_attachments() -> Vec<PathBuf> {
    Vec::new()
}

fn image_paths(count: usize) -> Vec<PathBuf> {
    (0..count)
        .map(|index| {
            PathBuf::from(format!(
                "/store/agent-attachments/threads/agt-1/{index}.png"
            ))
        })
        .collect()
}

fn inline_image(data: &[u8]) -> AgentImageAttachment {
    AgentImageAttachment::Inline {
        media_type: "image/png".to_string(),
        data: data.to_vec(),
    }
}

const CLAUDE_MODELS: [ClaudeModelChoice; 14] = [
    ClaudeModelChoice::Default,
    ClaudeModelChoice::Fable,
    ClaudeModelChoice::Opus,
    ClaudeModelChoice::Sonnet,
    ClaudeModelChoice::ClaudeFable51,
    ClaudeModelChoice::ClaudeFable5,
    ClaudeModelChoice::ClaudeOpus5,
    ClaudeModelChoice::ClaudeOpus48,
    ClaudeModelChoice::ClaudeOpus47,
    ClaudeModelChoice::ClaudeOpus46,
    ClaudeModelChoice::ClaudeOpus45,
    ClaudeModelChoice::ClaudeSonnet5,
    ClaudeModelChoice::ClaudeSonnet46,
    ClaudeModelChoice::ClaudeHaiku45,
];
const CLAUDE_MODES: [ClaudePermissionMode; 4] = [
    ClaudePermissionMode::Default,
    ClaudePermissionMode::Plan,
    ClaudePermissionMode::AcceptEdits,
    ClaudePermissionMode::BypassPermissions,
];
const CODEX_MODELS: [CodexModelChoice; 7] = [
    CodexModelChoice::Default,
    CodexModelChoice::Gpt6Astra,
    CodexModelChoice::Gpt56Sol,
    CodexModelChoice::Gpt56Terra,
    CodexModelChoice::Gpt56Luna,
    CodexModelChoice::Gpt55,
    CodexModelChoice::Gpt54,
];
const CODEX_MODES: [CodexExecutionMode; 4] = [
    CodexExecutionMode::Default,
    CodexExecutionMode::ReadOnly,
    CodexExecutionMode::WorkspaceWrite,
    CodexExecutionMode::DangerFullAccess,
];

const CLAUDE_EFFORTS: [ClaudeEffortChoice; 8] = [
    ClaudeEffortChoice::Default,
    ClaudeEffortChoice::Low,
    ClaudeEffortChoice::Medium,
    ClaudeEffortChoice::High,
    ClaudeEffortChoice::Xhigh,
    ClaudeEffortChoice::Max,
    ClaudeEffortChoice::Ultracode,
    ClaudeEffortChoice::Ultrathink,
];

fn claude_default() -> AgentLaunchOptions {
    AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::Default,
        mode: ClaudePermissionMode::Default,
        effort: ClaudeEffortChoice::Default,
        context: ClaudeContextChoice::OneM,
        fast_mode: false,
        thinking_mode: false,
    }
}

fn codex_default() -> AgentLaunchOptions {
    AgentLaunchOptions::Codex {
        model: CodexModelChoice::Default,
        mode: CodexExecutionMode::Default,
    }
}

#[test]
fn effective_path_replaces_only_path_in_the_agent_allowlist() {
    let environment = vec![
        ("HOME".to_string(), "/home/editor".to_string()),
        ("PATH".to_string(), "/usr/bin".to_string()),
        ("LANG".to_string(), "en_US.UTF-8".to_string()),
        ("PATH".to_string(), "/duplicate".to_string()),
    ];
    let effective_path =
        EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");

    assert_eq!(
        replace_effective_path(environment, effective_path),
        [
            ("HOME".to_string(), "/home/editor".to_string()),
            ("PATH".to_string(), "/opt/codevo/bin:/usr/bin".to_string()),
            ("LANG".to_string(), "en_US.UTF-8".to_string()),
        ]
    );
}

#[test]
fn effective_path_does_not_add_environment_outside_the_agent_allowlist() {
    let environment = vec![("HOME".to_string(), "/home/editor".to_string())];
    let effective_path =
        EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");

    assert_eq!(
        replace_effective_path(environment, effective_path),
        [
            ("HOME".to_string(), "/home/editor".to_string()),
            ("PATH".to_string(), "/opt/codevo/bin:/usr/bin".to_string()),
        ]
    );
}

fn poll_test_child_exit(
    child: &mut dyn AgentChild,
    deadline: std::time::Instant,
) -> Result<Option<i32>, String> {
    loop {
        if let Some(exit_code) = child.try_wait()? {
            return Ok(Some(exit_code));
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Ok(None);
        }
        std::thread::park_timeout(remaining.min(std::time::Duration::from_millis(1)));
    }
}

fn wait_for_test_child_exit(
    child: &mut dyn AgentChild,
    timeout: std::time::Duration,
) -> Result<i32, String> {
    let deadline = std::time::Instant::now() + timeout;
    let mut failure = match poll_test_child_exit(child, deadline) {
        Ok(Some(exit_code)) => return Ok(exit_code),
        Ok(None) => "Timed out waiting for agent child exit.".to_string(),
        Err(error) => error,
    };
    if let Err(error) = child.force_kill() {
        failure.push_str(&format!(" Kill failed: {error}"));
    }
    let reap_deadline = std::time::Instant::now() + timeout;
    match poll_test_child_exit(child, reap_deadline) {
        Ok(Some(_)) => Err(failure),
        Ok(None) => Err(format!("{failure} Reap timed out.")),
        Err(error) => Err(format!("{failure} Reap failed: {error}")),
    }
}

#[cfg(unix)]
#[test]
fn retained_cwd_authority_cannot_be_redirected_by_path_replacement() {
    let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = std::env::temp_dir().join(format!(
        "agent-task-retained-cwd-{}-{nonce}",
        std::process::id()
    ));
    let original = fixture.join("original");
    let retained = fixture.join("retained");
    fs::create_dir_all(&original).expect("create original cwd");
    let cwd_authority = Arc::new(fs::File::open(&original).expect("open cwd authority"));
    let plan = AgentTaskSpawnPlan::for_tests(
        PathBuf::from("/bin/pwd"),
        Vec::new(),
        original.clone(),
        inherited_environment(),
    )
    .with_cwd_authority(cwd_authority);
    fs::rename(&original, &retained).expect("move retained cwd");
    fs::create_dir_all(&original).expect("replace original cwd path");

    let mut child = StdAgentProcessSpawner
        .spawn(&plan)
        .expect("spawn retained cwd");
    let exit_code = wait_for_test_child_exit(child.as_mut(), std::time::Duration::from_secs(5))
        .expect("wait for pwd");
    let mut stdout = String::new();
    child
        .stdout_reader()
        .expect("stdout reader")
        .read_to_string(&mut stdout)
        .expect("read stdout");
    let mut stderr = String::new();
    child
        .stderr_reader()
        .expect("stderr reader")
        .read_to_string(&mut stderr)
        .expect("read stderr");

    assert_eq!(exit_code, 0, "stderr: {stderr}");
    assert_eq!(
        PathBuf::from(stdout.trim()),
        retained.canonicalize().expect("canonical retained cwd")
    );
    fs::remove_dir_all(&fixture).expect("remove cwd fixture");
}

#[cfg(unix)]
#[test]
fn retained_cli_identity_rejects_path_replacement_before_spawn() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = std::env::temp_dir().join(format!(
        "agent-task-retained-cli-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&fixture).expect("fixture");
    let cli = fixture.join("claude");
    fs::write(&cli, "#!/bin/sh\nexit 0\n").expect("cli");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("permissions");
    let plan = plan_agent_invocation(
        cli.to_str().expect("path"),
        AgentCliInvocation::ClaudeCode,
        "stop",
        &fixture,
        None,
        claude_default(),
    )
    .expect("plan");
    fs::rename(&cli, fixture.join("retained")).expect("rename");
    fs::write(&cli, "#!/bin/sh\nexit 7\n").expect("replacement");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("permissions");

    let error = match StdAgentProcessSpawner.spawn(&plan) {
        Ok(_) => panic!("replacement accepted"),
        Err(error) => error,
    };
    assert_eq!(
        error,
        "Agent CLI executable identity changed before launch."
    );
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn spawn_plan_removes_configured_symlink_indirection() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = std::env::temp_dir().join(format!(
        "agent-task-cli-symlink-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&fixture).expect("fixture");
    let retained = fixture.join("retained");
    fs::write(&retained, "#!/bin/sh\nexit 0\n").expect("cli");
    fs::set_permissions(&retained, fs::Permissions::from_mode(0o755)).expect("permissions");
    let configured = fixture.join("configured");
    symlink(&retained, &configured).expect("symlink");
    let plan = plan_agent_invocation(
        configured.to_str().expect("path"),
        AgentCliInvocation::ClaudeCode,
        "stop",
        &fixture,
        None,
        claude_default(),
    )
    .expect("plan");

    assert_eq!(
        plan.program,
        retained.canonicalize().expect("canonical cli")
    );
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn hostile_effective_path_cannot_replace_retained_script_interpreter() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = std::env::temp_dir().join(format!(
        "agent-task-retained-interpreter-{}-{nonce}",
        std::process::id()
    ));
    let safe = fixture.join("safe");
    let hostile = fixture.join("hostile");
    fs::create_dir_all(&safe).expect("safe directory");
    fs::create_dir_all(&hostile).expect("hostile directory");
    let safe_node = safe.join("node");
    symlink("/bin/sh", &safe_node).expect("safe node");
    let hostile_node = hostile.join("node");
    fs::write(&hostile_node, "#!/bin/sh\nprintf hostile\n").expect("hostile node");
    fs::set_permissions(&hostile_node, fs::Permissions::from_mode(0o755))
        .expect("hostile node permissions");
    let cli = fixture.join("claude");
    fs::write(&cli, "#!/usr/bin/env node\nprintf safe\n").expect("cli");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("cli permissions");
    let safe_path = safe.to_string_lossy().into_owned();
    let identity =
        agent_provider::process::executable_identity_path_with_effective_path(&cli, &safe_path)
            .expect("retained cli identity");
    let hostile_path = hostile.to_string_lossy().into_owned();
    let plan = plan_agent_invocation_with_authority(
        identity,
        AgentInvocationRequest {
            invocation: AgentCliInvocation::ClaudeCode,
            prompt: "stop",
            cwd: &fixture,
            resume_session_id: None,
            launch: claude_default(),
            attachments: Vec::new(),
        },
        EffectiveExecutablePath::new(&hostile_path).expect("hostile effective path"),
    )
    .expect("plan");

    let mut child = StdAgentProcessSpawner.spawn(&plan).expect("spawn cli");
    let exit_code = child.reap().expect("wait cli");
    let mut stdout = String::new();
    child
        .stdout_reader()
        .expect("stdout")
        .read_to_string(&mut stdout)
        .expect("read stdout");

    assert_eq!(exit_code, 0);
    assert_eq!(stdout, "safe");
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[test]
fn claude_first_turn_default_launch_keeps_the_pre_launch_argv_byte_for_byte() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::ClaudeCode,
            "do it",
            None,
            claude_default(),
            &no_attachments()
        ),
        CLAUDE_BASE_ARGV
    );
    assert_eq!(
        claude_user_frame("do it", &[]),
        br#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"do it"}]}}
"#
        .to_vec()
    );
}

#[test]
fn claude_follow_up_default_launch_keeps_the_pre_launch_argv_byte_for_byte() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::ClaudeCode,
            "do it",
            Some(SESSION_ID),
            claude_default(),
            &no_attachments()
        ),
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
            "--resume",
            SESSION_ID
        ]
    );
}

#[test]
fn codex_first_turn_allows_trusted_projects_without_a_git_repository() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::CodexExec,
            "do it",
            None,
            codex_default(),
            &no_attachments()
        ),
        ["exec", "--json", "--skip-git-repo-check", "--", "do it"]
    );
}

#[test]
fn codex_follow_up_allows_trusted_projects_without_a_git_repository() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::CodexExec,
            "do it",
            Some(SESSION_ID),
            codex_default(),
            &no_attachments()
        ),
        [
            "exec",
            "resume",
            "--json",
            "--skip-git-repo-check",
            SESSION_ID,
            "--",
            "do it"
        ]
    );
}

#[test]
fn claude_argv_places_model_then_mode_then_resume_after_the_stream_json_input_format() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::ClaudeCode,
            "do it",
            Some(SESSION_ID),
            AgentLaunchOptions::ClaudeCode {
                model: ClaudeModelChoice::Opus,
                mode: ClaudePermissionMode::AcceptEdits,
                effort: ClaudeEffortChoice::Default,
                context: ClaudeContextChoice::TwoHundredK,
                fast_mode: false,
                thinking_mode: false,
            },
            &no_attachments()
        ),
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
            "--model",
            "opus",
            "--permission-mode",
            "acceptEdits",
            "--resume",
            SESSION_ID
        ]
    );
}

#[test]
fn claude_ultracode_and_fast_mode_reach_the_cli_as_runtime_settings() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::ClaudeCode,
            "coordinate the fix",
            None,
            AgentLaunchOptions::ClaudeCode {
                model: ClaudeModelChoice::Opus,
                mode: ClaudePermissionMode::BypassPermissions,
                effort: ClaudeEffortChoice::Ultracode,
                context: ClaudeContextChoice::OneM,
                fast_mode: true,
                thinking_mode: false,
            },
            &no_attachments()
        ),
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
            "--model",
            "opus[1m]",
            "--dangerously-skip-permissions",
            "--effort",
            "xhigh",
            "--settings",
            r#"{"fastMode":true,"ultracode":true}"#,
        ]
    );
}

#[test]
fn claude_ultrathink_changes_the_dispatched_prompt_without_an_invalid_effort_flag() {
    let launch = AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::Fable,
        mode: ClaudePermissionMode::BypassPermissions,
        effort: ClaudeEffortChoice::Ultrathink,
        context: ClaudeContextChoice::OneM,
        fast_mode: false,
        thinking_mode: false,
    };
    let args = agent_invocation_args(
        AgentCliInvocation::ClaudeCode,
        "trace the race",
        None,
        launch,
        &no_attachments(),
    );
    let frame = agent_prompt_transport(
        AgentCliInvocation::ClaudeCode,
        &launch.prompt("trace the race"),
        Vec::new(),
    )
    .expect("claude prompt transport");

    assert!(!args.iter().any(|arg| arg == "--effort"));
    assert!(!args.iter().any(|arg| arg == "--"));
    assert_eq!(
        frame,
        AgentPromptTransport::Stdin(claude_user_frame("Ultrathink:\ntrace the race", &[]).into())
    );
}

#[test]
fn codex_astra_reaches_fresh_and_resumed_cli_invocations() {
    let launch = AgentLaunchOptions::Codex {
        model: CodexModelChoice::Gpt6Astra,
        mode: CodexExecutionMode::WorkspaceWrite,
    };
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::CodexExec,
            "do it",
            None,
            launch,
            &no_attachments()
        ),
        [
            "exec",
            "--json",
            "--skip-git-repo-check",
            "-m",
            "gpt-6-astra",
            "--sandbox",
            "workspace-write",
            "--",
            "do it"
        ]
    );
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::CodexExec,
            "do it",
            Some(SESSION_ID),
            launch,
            &no_attachments(),
        ),
        [
            "exec",
            "resume",
            "--json",
            "--skip-git-repo-check",
            "-m",
            "gpt-6-astra",
            "-c",
            "sandbox_mode=\"workspace-write\"",
            SESSION_ID,
            "--",
            "do it"
        ]
    );
}

#[test]
fn codex_resume_argv_places_options_before_the_positional_session_id() {
    assert_eq!(
        agent_invocation_args(
            AgentCliInvocation::CodexExec,
            "do it",
            Some(SESSION_ID),
            AgentLaunchOptions::Codex {
                model: CodexModelChoice::Gpt55,
                mode: CodexExecutionMode::WorkspaceWrite,
            },
            &no_attachments()
        ),
        [
            "exec",
            "resume",
            "--json",
            "--skip-git-repo-check",
            "-m",
            "gpt-5.5",
            "-c",
            "sandbox_mode=\"workspace-write\"",
            SESSION_ID,
            "--",
            "do it"
        ]
    );
}

#[test]
fn claude_argv_table_covers_every_model_mode_and_resume_combination() {
    for model in CLAUDE_MODELS {
        for mode in CLAUDE_MODES {
            for effort in CLAUDE_EFFORTS {
                let launch = AgentLaunchOptions::ClaudeCode {
                    model,
                    mode,
                    effort,
                    context: ClaudeContextChoice::TwoHundredK,
                    fast_mode: false,
                    thinking_mode: false,
                };
                for resume in [None, Some(SESSION_ID)] {
                    for images in [0usize, 1, 8] {
                        let mut expected: Vec<String> =
                            CLAUDE_BASE_ARGV.into_iter().map(str::to_string).collect();
                        expected.extend(launch.model_args().iter().map(|arg| (*arg).to_string()));
                        expected.extend(
                            launch
                                .mode_args(resume.is_some())
                                .iter()
                                .map(|arg| (*arg).to_string()),
                        );
                        expected.extend(launch.effort_args().iter().map(|arg| (*arg).to_string()));
                        expected
                            .extend(launch.settings_args().iter().map(|arg| (*arg).to_string()));
                        if let Some(session_id) = resume {
                            expected.push("--resume".to_string());
                            expected.push(session_id.to_string());
                        }
                        let attachments: Vec<AgentImageAttachment> = (0..images)
                            .map(|index| inline_image(&[0x89, 0x50, index as u8]))
                            .collect();
                        let inline: Vec<(String, Vec<u8>)> = (0..images)
                            .map(|index| ("image/png".to_string(), vec![0x89, 0x50, index as u8]))
                            .collect();
                        assert_eq!(
                            agent_invocation_args(
                                AgentCliInvocation::ClaudeCode,
                                "do it",
                                resume,
                                launch,
                                &attachment_image_paths(
                                    AgentCliInvocation::ClaudeCode,
                                    &attachments
                                )
                                .expect("claude carries images on stdin")
                            ),
                            expected,
                            "claude {model:?}/{mode:?}/{effort:?} resume={} images={images}",
                            resume.is_some()
                        );
                        assert_eq!(
                            agent_prompt_transport(
                                AgentCliInvocation::ClaudeCode,
                                &launch.prompt("do it"),
                                attachments,
                            ),
                            Ok(AgentPromptTransport::Stdin(
                                claude_user_frame(&launch.prompt("do it"), &inline).into()
                            )),
                            "claude frame {model:?}/{mode:?}/{effort:?} images={images}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn codex_argv_table_covers_every_model_mode_and_resume_combination() {
    for model in CODEX_MODELS {
        for mode in CODEX_MODES {
            let launch = AgentLaunchOptions::Codex { model, mode };
            for resume in [None, Some(SESSION_ID)] {
                for images in [0usize, 1, 8] {
                    let paths = image_paths(images);
                    let mut expected: Vec<String> = match resume {
                        Some(_) => vec!["exec", "resume", "--json", "--skip-git-repo-check"],
                        None => vec!["exec", "--json", "--skip-git-repo-check"],
                    }
                    .into_iter()
                    .map(str::to_string)
                    .collect();
                    expected.extend(launch.model_args().iter().map(|arg| (*arg).to_string()));
                    expected.extend(
                        launch
                            .mode_args(resume.is_some())
                            .iter()
                            .map(|arg| (*arg).to_string()),
                    );
                    for path in &paths {
                        expected.push("-i".to_string());
                        expected.push(path.to_string_lossy().into_owned());
                    }
                    if let Some(session_id) = resume {
                        expected.push(session_id.to_string());
                    }
                    expected.push("--".to_string());
                    expected.push("do it".to_string());
                    assert_eq!(
                        agent_invocation_args(
                            AgentCliInvocation::CodexExec,
                            "do it",
                            resume,
                            launch,
                            &paths
                        ),
                        expected,
                        "codex {model:?}/{mode:?} resume={} images={images}",
                        resume.is_some()
                    );
                    assert_eq!(
                        agent_prompt_transport(
                            AgentCliInvocation::CodexExec,
                            "do it",
                            paths
                                .iter()
                                .cloned()
                                .map(AgentImageAttachment::Path)
                                .collect(),
                        ),
                        Ok(AgentPromptTransport::Argv("do it".to_string()))
                    );
                }
            }
        }
    }
}

#[test]
fn the_claude_stdin_frame_matches_the_probe_fixture_byte_for_byte() {
    use base64::Engine;

    const FIXTURE: &str =
        include_str!("../../src/domain/agentOutput/fixtures/claude-image-turn.input.jsonl");

    let line = FIXTURE.trim_end_matches('\n');
    let start = line.find("\"data\":\"").expect("fixture data field") + 8;
    let end = start + line[start..].find('"').expect("fixture data end");
    let raw_data = &line[start..end];
    let prefix = raw_data
        .split("\\u2026")
        .next()
        .expect("truncated base64 prefix");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(prefix)
        .expect("the committed prefix is whole base64");
    let parsed: serde_json::Value = serde_json::from_str(line).expect("fixture json");
    let prompt = parsed["message"]["content"][1]["text"]
        .as_str()
        .expect("the text block is last");

    let frame = claude_user_frame(prompt, &[("image/png".to_string(), decoded)]);

    assert_eq!(
        String::from_utf8(frame).expect("utf-8 frame"),
        format!("{}\n", line.replacen(raw_data, prefix, 1)),
        "the frame must match the probed input line byte for byte"
    );
}

#[test]
fn the_claude_frame_puts_every_image_before_the_single_trailing_text_block() {
    let frame = claude_user_frame(
        "look",
        &[
            ("image/png".to_string(), vec![1]),
            ("image/webp".to_string(), vec![2]),
        ],
    );
    let parsed: serde_json::Value = serde_json::from_slice(&frame).expect("frame is one json line");

    assert_eq!(parsed["type"], "user");
    assert_eq!(parsed["message"]["role"], "user");
    assert_eq!(parsed["message"]["content"][0]["type"], "image");
    assert_eq!(
        parsed["message"]["content"][0]["source"]["media_type"],
        "image/png"
    );
    assert_eq!(parsed["message"]["content"][1]["type"], "image");
    assert_eq!(parsed["message"]["content"][2]["type"], "text");
    assert_eq!(parsed["message"]["content"][2]["text"], "look");
    assert_eq!(parsed["message"]["content"][3], serde_json::Value::Null);
    assert_eq!(frame.last(), Some(&b'\n'));
}

#[test]
fn the_turn_image_budget_is_enforced_before_the_frame_is_built() {
    let oversized = agent_prompt_transport(
        AgentCliInvocation::ClaudeCode,
        "do it",
        vec![
            inline_image(&vec![0u8; (MAX_AGENT_TURN_IMAGE_BYTES / 2 + 1) as usize]),
            inline_image(&vec![0u8; (MAX_AGENT_TURN_IMAGE_BYTES / 2 + 1) as usize]),
        ],
    )
    .expect_err("the aggregate turn budget is enforced before spawning");

    assert_eq!(oversized, AGENT_TURN_IMAGE_BUDGET_ERROR);
}

#[test]
fn each_provider_refuses_the_other_providers_image_transport() {
    let claude = agent_prompt_transport(
        AgentCliInvocation::ClaudeCode,
        "do it",
        vec![AgentImageAttachment::Path(PathBuf::from("/store/a.png"))],
    )
    .expect_err("claude never receives a path");
    let codex = attachment_image_paths(
        AgentCliInvocation::CodexExec,
        &[inline_image(&[0x89, 0x50])],
    )
    .expect_err("codex never receives inline bytes");

    assert_eq!(claude, AGENT_IMAGE_TRANSPORT_MISMATCH_ERROR);
    assert_eq!(codex, AGENT_IMAGE_TRANSPORT_MISMATCH_ERROR);
}

#[cfg(unix)]
#[test]
fn a_claude_plan_pipes_its_frame_and_closes_stdin_so_the_child_exits() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = std::env::temp_dir().join(format!(
        "agent-task-stdin-frame-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&fixture).expect("fixture");
    let cli = fixture.join("claude");
    fs::write(&cli, "#!/bin/sh\ncat\n").expect("cli");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("permissions");
    let plan = plan_agent_invocation_with_attachments(
        cli.to_str().expect("path"),
        AgentCliInvocation::ClaudeCode,
        "describe it",
        &fixture,
        None,
        claude_default(),
        vec![inline_image(&[0x89, 0x50, 0x4e, 0x47])],
    )
    .expect("plan");

    let mut child = StdAgentProcessSpawner.spawn(&plan).expect("spawn");
    let exit_code = wait_for_test_child_exit(child.as_mut(), std::time::Duration::from_secs(5))
        .expect("the child exits at stdin EOF");
    let mut stdout = String::new();
    child
        .stdout_reader()
        .expect("stdout")
        .read_to_string(&mut stdout)
        .expect("read stdout");

    assert_eq!(exit_code, 0);
    assert_eq!(
        stdout.into_bytes(),
        claude_user_frame(
            "describe it",
            &[("image/png".to_string(), vec![0x89, 0x50, 0x4e, 0x47])]
        )
    );
    assert!(plan.attachment_paths().is_empty());
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn a_codex_plan_keeps_its_prompt_positional_and_never_pipes_stdin() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
    let fixture = std::env::temp_dir().join(format!(
        "agent-task-codex-argv-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&fixture).expect("fixture");
    let cli = fixture.join("codex");
    fs::write(&cli, "#!/bin/sh\nexit 0\n").expect("cli");
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("permissions");
    let image = fixture.join("shot.png");
    let plan = plan_agent_invocation_with_attachments(
        cli.to_str().expect("path"),
        AgentCliInvocation::CodexExec,
        "describe it",
        &fixture,
        Some(SESSION_ID),
        codex_default(),
        vec![AgentImageAttachment::Path(image.clone())],
    )
    .expect("plan");

    assert_eq!(
        plan.args(),
        [
            "exec".to_string(),
            "resume".to_string(),
            "--json".to_string(),
            "--skip-git-repo-check".to_string(),
            "-i".to_string(),
            image.to_string_lossy().into_owned(),
            SESSION_ID.to_string(),
            "--".to_string(),
            "describe it".to_string(),
        ]
    );
    assert_eq!(
        plan.prompt(),
        &AgentPromptTransport::Argv("describe it".to_string())
    );
    assert_eq!(plan.attachment_paths(), [image]);
    fs::remove_dir_all(fixture).expect("cleanup");
}

#[test]
fn planning_rejects_launch_options_from_another_provider() {
    let mismatch = plan_agent_invocation(
        "",
        AgentCliInvocation::ClaudeCode,
        "do it",
        Path::new("/workspace"),
        None,
        codex_default(),
    )
    .expect_err("cross-provider launch must be refused");
    assert_eq!(mismatch, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);

    let reversed = plan_agent_invocation(
        "",
        AgentCliInvocation::CodexExec,
        "do it",
        Path::new("/workspace"),
        None,
        claude_default(),
    )
    .expect_err("cross-provider launch must be refused");
    assert_eq!(reversed, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);
}

#[test]
fn accepts_session_ids_within_the_safe_pattern() {
    assert_eq!(
        validate_resume_session_id("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"),
        Ok("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b")
    );
    assert!(validate_resume_session_id("abcd_efg").is_ok());
    assert!(validate_resume_session_id(&"a".repeat(MAX_AGENT_SESSION_ID_BYTES)).is_ok());
}

#[test]
fn rejects_flag_like_short_oversize_and_non_ascii_session_ids() {
    assert!(validate_resume_session_id("-resume-me").is_err());
    assert!(validate_resume_session_id("--flag123").is_err());
    assert!(validate_resume_session_id("short").is_err());
    assert!(validate_resume_session_id("").is_err());
    assert!(validate_resume_session_id(&"a".repeat(MAX_AGENT_SESSION_ID_BYTES + 1)).is_err());
    assert!(validate_resume_session_id("has space").is_err());
    assert!(validate_resume_session_id("sess/ion1").is_err());
    assert!(validate_resume_session_id("sessi\u{00f3}n01").is_err());
}

#[test]
fn planning_rejects_unsafe_resume_session_ids_before_any_other_work() {
    let flag_like = plan_agent_invocation(
        "",
        AgentCliInvocation::ClaudeCode,
        "do it",
        Path::new("/workspace"),
        Some("--dangerously-skip-permissions"),
        claude_default(),
    )
    .expect_err("flag-like resume id must be refused");
    let oversize = plan_agent_invocation(
        "",
        AgentCliInvocation::CodexExec,
        "do it",
        Path::new("/workspace"),
        Some(&"a".repeat(MAX_AGENT_SESSION_ID_BYTES + 1)),
        codex_default(),
    )
    .expect_err("oversize resume id must be refused");

    assert!(flag_like.contains("session id"), "got: {flag_like}");
    assert!(oversize.contains("session id"), "got: {oversize}");
}
