use super::*;
use crate::agent_task_spawner::agent_launch::{AgentLaunchOptions, ClaudeEffortChoice};
use std::time::{Duration, Instant};

fn fingerprint() -> ClaudeSessionFingerprint {
    ClaudeSessionFingerprint {
        executable: ExecutableFingerprint {
            path: PathBuf::from("/opt/claude"),
            size_bytes: 10,
            modified_epoch_ms: 20,
            device: 1,
            inode: 2,
        },
        provider_generation: 7,
        launch: AgentLaunchOptions::default(),
        args_without_resume: vec!["-p".to_string()],
        env: vec![("HOME".to_string(), "/home/a".to_string())],
        cwd: PathBuf::from("/repo"),
        cwd_identity: Some((1, 99)),
    }
}

fn live<'a>(
    fingerprint: &'a ClaudeSessionFingerprint,
    conversation: Option<&'a str>,
    availability: SessionAvailability,
) -> Option<LiveSessionFacts<'a>> {
    Some(LiveSessionFacts {
        fingerprint,
        conversation,
        availability,
    })
}

fn asked<'a>(
    fingerprint: &'a ClaudeSessionFingerprint,
    resume: Option<&'a str>,
) -> RequestedSessionFacts<'a> {
    RequestedSessionFacts {
        fingerprint,
        resume_session_id: resume,
    }
}

#[test]
fn spawns_without_a_live_session() {
    let wanted = fingerprint();
    assert_eq!(
        decide_session_disposition(None, asked(&wanted, None)),
        ClaudeSessionDisposition::Spawn
    );
}

#[test]
fn reuses_only_an_idle_identical_session_on_the_same_conversation() {
    let current = fingerprint();
    let wanted = fingerprint();
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Idle),
            asked(&wanted, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Reuse
    );
}

#[test]
fn an_attached_session_is_busy_and_an_ending_one_is_replaced() {
    let current = fingerprint();
    let wanted = fingerprint();
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Attached),
            asked(&wanted, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Busy
    );
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Ending),
            asked(&wanted, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::Unhealthy)
    );
}

#[test]
fn provider_generation_or_binary_changes_restart_without_confirmation() {
    let current = fingerprint();
    let mut wanted = fingerprint();
    wanted.provider_generation = 8;
    let decision = decide_session_disposition(
        live(&current, Some("sess-1"), SessionAvailability::Idle),
        asked(&wanted, Some("sess-1")),
    );
    assert_eq!(
        decision,
        ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ProviderChanged)
    );
    assert!(!ClaudeSessionRestartReason::ProviderChanged.needs_confirmation());
    let mut rebuilt = fingerprint();
    rebuilt.executable.inode = 3;
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Idle),
            asked(&rebuilt, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ProviderChanged)
    );
}

#[test]
fn launch_args_env_or_cwd_identity_changes_restart_with_confirmation() {
    let current = fingerprint();
    let mut effort = fingerprint();
    effort.launch = match effort.launch {
        AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            context,
            fast_mode,
            thinking_mode,
            chrome,
            ..
        } => AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            effort: ClaudeEffortChoice::Low,
            context,
            fast_mode,
            thinking_mode,
            chrome,
        },
        other => other,
    };
    let mut recreated_cwd = fingerprint();
    recreated_cwd.cwd_identity = Some((1, 100));
    for wanted in [effort, recreated_cwd] {
        assert_eq!(
            decide_session_disposition(
                live(&current, Some("sess-1"), SessionAvailability::Idle),
                asked(&wanted, Some("sess-1"))
            ),
            ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::LaunchChanged)
        );
    }
    assert!(ClaudeSessionRestartReason::LaunchChanged.needs_confirmation());
}

#[test]
fn a_fresh_or_different_conversation_restarts() {
    let current = fingerprint();
    let wanted = fingerprint();
    for resume in [None, Some("sess-2")] {
        assert_eq!(
            decide_session_disposition(
                live(&current, Some("sess-1"), SessionAvailability::Idle),
                asked(&wanted, resume)
            ),
            ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ConversationChanged)
        );
    }
}

#[test]
fn args_without_resume_strips_only_the_resume_pair() {
    let args: Vec<String> = ["-p", "--resume", "sess-1", "--model", "opus"]
        .into_iter()
        .map(str::to_string)
        .collect();
    assert_eq!(args_without_resume(&args), vec!["-p", "--model", "opus"]);
}

fn candidate(
    key: &str,
    attached: bool,
    background: bool,
    age_secs: u64,
    generation: u64,
    now: Instant,
) -> EvictionCandidate {
    EvictionCandidate {
        key: ClaudeSessionKey {
            workspace_id: "ws".to_string(),
            thread_id: key.to_string(),
        },
        generation,
        attached,
        background,
        last_activity: now - Duration::from_secs(age_secs),
    }
}

#[test]
fn eviction_prefers_idle_sessions_without_background_tasks_then_oldest_then_lowest_generation() {
    let now = Instant::now();
    let candidates = vec![
        candidate("busy", true, false, 900, 1, now),
        candidate("background-old", false, true, 800, 2, now),
        candidate("quiet-new", false, false, 10, 3, now),
        candidate("quiet-old", false, false, 500, 4, now),
    ];
    assert_eq!(
        choose_eviction(&candidates).map(|key| key.thread_id.as_str()),
        Some("quiet-old")
    );
    let tie = vec![
        candidate("b", false, false, 100, 9, now),
        candidate("a", false, false, 100, 5, now),
    ];
    assert_eq!(
        choose_eviction(&tie).map(|key| key.thread_id.as_str()),
        Some("a")
    );
    let only_background = vec![
        candidate("new", false, true, 10, 7, now),
        candidate("old", false, true, 900, 8, now),
    ];
    assert_eq!(
        choose_eviction(&only_background).map(|key| key.thread_id.as_str()),
        Some("old")
    );
    assert!(choose_eviction(&[candidate("busy", true, false, 1, 1, now)]).is_none());
}

#[test]
fn idle_retirement_uses_the_detached_work_ttl_only_while_native_background_tasks_are_live() {
    let tuning = ClaudeSessionTuning::default();
    let now = Instant::now();
    let idle_since = now - tuning.idle_ttl;
    assert!(idle_retirement_due(
        &tuning,
        SessionAvailability::Idle,
        false,
        idle_since,
        now
    ));
    assert!(!idle_retirement_due(
        &tuning,
        SessionAvailability::Idle,
        true,
        idle_since,
        now
    ));
    assert!(!idle_retirement_due(
        &tuning,
        SessionAvailability::Attached,
        false,
        now - tuning.detached_work_ttl,
        now
    ));
    assert!(idle_retirement_due(
        &tuning,
        SessionAvailability::Idle,
        true,
        now - tuning.detached_work_ttl,
        now
    ));
}

#[test]
fn inspection_and_ended_event_serialize_to_the_pinned_wire_shape() {
    assert_eq!(
        serde_json::to_string(&ClaudeSessionInspection::Restart {
            background_tasks: true
        })
        .unwrap(),
        r#"{"kind":"restart","backgroundTasks":true}"#
    );
    assert_eq!(
        serde_json::to_string(&ClaudeSessionInspection::Reuse {
            background_tasks: false
        })
        .unwrap(),
        r#"{"kind":"reuse","backgroundTasks":false}"#
    );
    assert_eq!(
        serde_json::to_string(&ClaudeSessionInspection::None).unwrap(),
        r#"{"kind":"none"}"#
    );
    let event = ClaudeSessionEndedEvent {
        workspace_id: "ws-1".to_string(),
        thread_id: "agt-1-0a1c".to_string(),
        reason: ClaudeSessionEndReason::IdleTimeout,
        background_tasks_live: true,
    };
    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","reason":"idleTimeout","backgroundTasksLive":true}"#
    );
    let policy: ClaudeSessionRestartPolicy = serde_json::from_str(r#""stopBackground""#).unwrap();
    assert_eq!(policy, ClaudeSessionRestartPolicy::StopBackground);
}

#[test]
fn the_restart_confirmation_error_names_background_tasks_not_processes() {
    assert_eq!(
        CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR,
        "sessionRestartRequiresConfirmation: Restarting ends this Claude session. Background tasks it started may stop."
    );
}

#[test]
fn inspect_reports_restart_for_a_changed_launch_or_conversation() {
    let current = fingerprint();
    let facts = LiveSessionFacts {
        fingerprint: &current,
        conversation: Some("sess-1"),
        availability: SessionAvailability::Idle,
    };
    assert_eq!(
        inspect_session(Some((facts, true)), &current.launch, Some("sess-1"), 7),
        ClaudeSessionInspection::Reuse {
            background_tasks: true
        }
    );
    let facts = LiveSessionFacts {
        fingerprint: &current,
        conversation: Some("sess-1"),
        availability: SessionAvailability::Idle,
    };
    assert_eq!(
        inspect_session(Some((facts, false)), &current.launch, Some("sess-2"), 7),
        ClaudeSessionInspection::Restart {
            background_tasks: false
        }
    );
    assert_eq!(
        inspect_session(None, &current.launch, None, 7),
        ClaudeSessionInspection::None
    );
}

#[test]
fn background_turn_event_serializes_to_the_pinned_wire_shape() {
    let event = ClaudeSessionBackgroundTurnEvent {
        workspace_id: "ws-1".to_string(),
        thread_id: "agt-1-0a1c".to_string(),
        output: "...".to_string(),
        truncated: false,
        complete: true,
    };
    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","output":"...","truncated":false,"complete":true}"#
    );
}

#[test]
fn background_turn_event_keeps_only_complete_valid_utf8_lines() {
    let key = ClaudeSessionKey {
        workspace_id: "ws-1".to_string(),
        thread_id: "agt-1-0a1c".to_string(),
    };
    let valid = ClaudeSessionBackgroundTurnEvent::from_output(&key, b"{}\n".to_vec(), false, true);
    assert_eq!(valid.output, "{}\n");
    assert!(!valid.truncated);
    let mut broken = b"{\"a\":1}\n{\"b\":\"".to_vec();
    broken.extend_from_slice(&[0xff, b'"', b'}', b'\n']);
    let event = ClaudeSessionBackgroundTurnEvent::from_output(&key, broken, false, false);
    assert_eq!(event.output, "{\"a\":1}\n");
    assert!(event.truncated);
    assert!(!event.complete);
    assert_eq!(event.workspace_id, "ws-1");
    assert_eq!(event.thread_id, "agt-1-0a1c");
}

#[test]
fn background_tasks_event_serializes_to_the_pinned_wire_shape() {
    let event = ClaudeSessionBackgroundTasksEvent {
        workspace_id: "ws-1".to_string(),
        thread_id: "agt-1-0a1c".to_string(),
        total: 2,
        agents: 1,
        tasks: vec![
            ClaudeSessionBackgroundTask {
                task_id: "a4b355dcf6056a875".to_string(),
                task_type: ClaudeSessionBackgroundTaskType::Agent,
                description: Some("Live Codex model catalog like Claude".to_string()),
            },
            ClaudeSessionBackgroundTask {
                task_id: "bdxqm7bz6".to_string(),
                task_type: ClaudeSessionBackgroundTaskType::Shell,
                description: None,
            },
        ],
        reply: ClaudeSessionBackgroundReply::None,
    };
    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":2,"agents":1,"tasks":[{"taskId":"a4b355dcf6056a875","taskType":"agent","description":"Live Codex model catalog like Claude"},{"taskId":"bdxqm7bz6","taskType":"shell"}],"reply":"none"}"#
    );
    let replying = ClaudeSessionBackgroundTasksEvent {
        total: 0,
        agents: 0,
        tasks: Vec::new(),
        reply: ClaudeSessionBackgroundReply::InProgress,
        ..event
    };
    assert_eq!(
        serde_json::to_string(&replying).unwrap(),
        r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":0,"agents":0,"tasks":[],"reply":"inProgress"}"#
    );
    let expecting = ClaudeSessionBackgroundTasksEvent {
        reply: ClaudeSessionBackgroundReply::Expected,
        ..replying
    };
    assert_eq!(
        serde_json::to_string(&expecting).unwrap(),
        r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":0,"agents":0,"tasks":[],"reply":"expected"}"#
    );
}

fn claude_launch(model: &str, context: Option<&str>) -> AgentLaunchOptions {
    let mut wire = serde_json::json!({
        "provider": "claudeCode",
        "model": model,
        "mode": "bypassPermissions",
        "effort": "high"
    });
    if let Some(context) = context {
        wire["context"] = context.into();
    }
    serde_json::from_value(wire).expect("claude launch")
}

fn launched_with(launch: AgentLaunchOptions, args: Vec<String>) -> ClaudeSessionFingerprint {
    let plan = crate::agent_task_spawner::AgentTaskSpawnPlan::for_tests(
        std::env::current_exe().expect("test binary"),
        args,
        PathBuf::from("/repo"),
        Vec::new(),
    );
    crate::agent_task_spawner::claude_session_turn::session_fingerprint(&plan, launch, 7)
}

fn launched(launch: AgentLaunchOptions) -> ClaudeSessionFingerprint {
    launched_with(launch, launch.model_args())
}

fn disposition(
    current: &ClaudeSessionFingerprint,
    wanted: &ClaudeSessionFingerprint,
) -> ClaudeSessionDisposition {
    decide_session_disposition(
        live(current, Some("sess-1"), SessionAvailability::Idle),
        asked(wanted, Some("sess-1")),
    )
}

const CONTEXTS: [Option<&str>; 3] = [None, Some("200k"), Some("1m")];
const LAUNCH_CHANGED: ClaudeSessionDisposition =
    ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::LaunchChanged);

#[test]
fn a_context_on_a_fixed_window_model_never_restarts_the_session() {
    for held in CONTEXTS {
        for requested in CONTEXTS {
            assert_eq!(
                disposition(
                    &launched(claude_launch("claude-opus-4-7", held)),
                    &launched(claude_launch("claude-opus-4-7", requested))
                ),
                ClaudeSessionDisposition::Reuse,
                "held {held:?}, requested {requested:?}"
            );
        }
    }
}

#[test]
fn a_context_restarts_the_session_only_when_it_changes_the_model_argument() {
    for (held, requested, expected) in [
        (None, Some("200k"), ClaudeSessionDisposition::Reuse),
        (Some("200k"), None, ClaudeSessionDisposition::Reuse),
        (Some("1m"), Some("1m"), ClaudeSessionDisposition::Reuse),
        (Some("200k"), Some("1m"), LAUNCH_CHANGED),
        (Some("1m"), Some("200k"), LAUNCH_CHANGED),
        (None, Some("1m"), LAUNCH_CHANGED),
    ] {
        assert_eq!(
            disposition(
                &launched(claude_launch("claude-opus-4-6", held)),
                &launched(claude_launch("claude-opus-4-6", requested))
            ),
            expected,
            "held {held:?}, requested {requested:?}"
        );
    }
}

#[test]
fn the_session_identity_follows_the_launched_arguments_not_a_later_catalog() {
    let argument = |value: &str| vec!["--model".to_string(), value.to_string()];
    for (model, value) in [
        ("claude-opus-4-6", "claude-opus-4-6"),
        ("claude-opus-4-7", "claude-opus-4-7[1m]"),
    ] {
        let held = launched_with(claude_launch(model, Some("1m")), argument(value));
        let requested = launched_with(claude_launch(model, Some("200k")), argument(value));
        assert_eq!(held, requested, "{value}");
        assert_eq!(
            disposition(&held, &requested),
            ClaudeSessionDisposition::Reuse,
            "{value}"
        );
    }
    let plain = launched_with(
        claude_launch("claude-opus-4-6", Some("1m")),
        argument("claude-opus-4-6"),
    );
    let large = launched_with(
        claude_launch("claude-opus-4-6", Some("1m")),
        argument("claude-opus-4-6[1m]"),
    );
    assert_ne!(plain, large);
    assert_eq!(disposition(&plain, &large), LAUNCH_CHANGED);
}

#[test]
fn inspection_agrees_with_the_disposition_for_every_context_pair() {
    for model in [
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "default",
    ] {
        for held in CONTEXTS {
            for requested in CONTEXTS {
                let current = launched(claude_launch(model, held));
                let wanted = claude_launch(model, requested);
                let reusable =
                    disposition(&current, &launched(wanted)) == ClaudeSessionDisposition::Reuse;
                let facts = LiveSessionFacts {
                    fingerprint: &current,
                    conversation: Some("sess-1"),
                    availability: SessionAvailability::Idle,
                };
                let inspected = inspect_session(Some((facts, false)), &wanted, Some("sess-1"), 7);
                assert_eq!(
                    inspected
                        == ClaudeSessionInspection::Reuse {
                            background_tasks: false
                        },
                    reusable,
                    "{model}: held {held:?}, requested {requested:?}"
                );
            }
        }
    }
}
