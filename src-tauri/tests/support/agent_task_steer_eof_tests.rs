use super::*;

fn user_frame(text: &str) -> Vec<u8> {
    let mut frame = serde_json::to_vec(&serde_json::json!({
        "type": "user",
        "message": {"role": "user", "content": text}
    }))
    .expect("serialize user frame");
    frame.push(b'\n');
    frame
}

fn stdout_for(sink: &RecordingSink, task_id: &str) -> String {
    outputs_for(sink, task_id)
        .iter()
        .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
        .map(|event| event.chunk.as_str())
        .collect()
}

#[derive(Clone, Copy)]
enum FollowUpOutcome {
    CompletedFirst,
    ResultFirst,
    AbruptExit,
}

fn pending_follow_up_survives_previous_result(outcome: FollowUpOutcome) {
    let cwd = unique_path("steer-result-eof");
    fs::create_dir_all(&cwd).expect("fixture directory");
    let admission_registry = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission_registry),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    let admission = admission_registry
        .reserve(
            &workspace(STEER_WORKSPACE),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    // A real pipe's EOF cancels the pending response. The FIFO gate is released
    // only after the native output pump has processed the previous root result;
    // no scheduling delay is used to manufacture the race.
    let source = r#"
import json, os, select, sys

def emit(value):
    print(json.dumps(value), flush=True)

def lifecycle(command, state):
    emit({'type': 'command_lifecycle', 'command_uuid': command, 'state': state})

def result(marker):
    emit({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': marker})

os.mkfifo('continue-follow-up')
gate = os.open('continue-follow-up', os.O_RDWR | os.O_NONBLOCK)
initial = json.loads(sys.stdin.readline())
lifecycle(initial['uuid'], 'queued')
lifecycle(initial['uuid'], 'started')
emit({'type': 'system', 'subtype': 'notification', 'text': 'initial-ready'})
followup = json.loads(sys.stdin.readline())
assert followup['uuid'] != initial['uuid']
if sys.argv[1] == 'abrupt-exit':
    lifecycle(followup['uuid'], 'queued')
    sys.exit(0)
lifecycle(initial['uuid'], 'completed')
result('previous-root-result')
ready, _, _ = select.select([0, gate], [], [], 5)
if 0 in ready:
    assert os.read(0, 1) == b''
    sys.exit(23)
if gate not in ready:
    sys.exit(24)
os.read(gate, 1)
# Even if both descriptors became readable together, EOF must win.
if select.select([0], [], [], 0)[0]:
    assert os.read(0, 1) == b''
    sys.exit(23)
lifecycle(followup['uuid'], 'started')
emit({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Follow-up delivered'}]}})
if sys.argv[1] == 'completed-first':
    lifecycle(followup['uuid'], 'completed')
    result('follow-up-result')
else:
    result('follow-up-result')
    lifecycle(followup['uuid'], 'completed')
# Successful lifecycle completion must close the stream without a host Stop.
assert sys.stdin.read() == ''
os.close(gate)
"#;
    let python = probe_binary(&["/usr/bin/python3", "/opt/homebrew/bin/python3"])
        .expect("Python 3 for EOF-sensitive real-process fixture");
    let plan = AgentTaskSpawnPlan::for_tests(
        python,
        vec![
            "-c".to_string(),
            source.to_string(),
            match outcome {
                FollowUpOutcome::CompletedFirst => "completed-first",
                FollowUpOutcome::ResultFirst => "result-first",
                FollowUpOutcome::AbruptExit => "abrupt-exit",
            }
            .to_string(),
        ],
        cwd.clone(),
        Vec::new(),
    )
    .with_stdin_frame_for_tests(user_frame("initial prompt"));
    let task_id = "agt-steer-result-eof";
    registry
        .start(
            AgentTaskStartRequest {
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
                ..start_request(task_id, &cwd)
            },
            plan,
            admission,
        )
        .expect("start");
    registry.acknowledge(task_id).expect("acknowledge");
    assert!(
        wait_until(EVENT_DEADLINE, || stdout_for(&sink, task_id)
            .contains("initial-ready")),
        "initial command did not start"
    );
    steer_frame(&registry, task_id, &user_frame("follow-up prompt"))
        .expect("accept follow-up while initial command is running");
    if matches!(outcome, FollowUpOutcome::AbruptExit) {
        assert!(
            wait_until(EVENT_DEADLINE, || sink.has_terminal_status(task_id)),
            "abrupt child exit never settled"
        );
        let statuses = statuses_for(&sink, task_id);
        assert!(
            matches!(
                statuses.last().map(|event| &event.status),
                Some(AgentTaskStatusPayload::Failed { message })
                    if message.ends_with("Claude exited before completing an accepted follow-up message.")
            ),
            "accepted but unfinished follow-up must not report success: {statuses:?}"
        );
        assert!(!stdout_for(&sink, task_id).contains("Follow-up delivered"));
        drop(registry);
        fs::remove_dir_all(cwd).expect("fixture cleanup");
        return;
    }
    assert!(
        wait_until(EVENT_DEADLINE, || stdout_for(&sink, task_id)
            .contains("previous-root-result")),
        "previous result never reached the output pump"
    );
    // Opening read/write avoids blocking forever if the broken implementation
    // has already closed stdin and the child has exited.
    use std::io::Write;
    let mut gate = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(cwd.join("continue-follow-up"))
        .expect("open follow-up gate");
    gate.write_all(b"1").expect("release follow-up gate");
    assert!(
        wait_until(EVENT_DEADLINE, || sink.has_terminal_status(task_id)),
        "completed follow-up did not settle naturally"
    );
    let stdout = stdout_for(&sink, task_id);
    assert!(
        stdout.contains("Follow-up delivered"),
        "previous result closed stdin before pending follow-up started: {stdout}"
    );
    assert!(stdout.contains("follow-up-result"));
    assert!(matches!(
        statuses_for(&sink, task_id)
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
    drop(gate);
    drop(registry);
    fs::remove_dir_all(cwd).expect("fixture cleanup");
}

#[test]
fn real_process_pending_steer_survives_old_result_then_completed_before_result() {
    pending_follow_up_survives_previous_result(FollowUpOutcome::CompletedFirst);
}

#[test]
fn real_process_pending_steer_survives_old_result_then_result_before_completed() {
    pending_follow_up_survives_previous_result(FollowUpOutcome::ResultFirst);
}

#[test]
fn real_process_pending_steer_reports_failure_when_child_exits_zero_before_reply() {
    pending_follow_up_survives_previous_result(FollowUpOutcome::AbruptExit);
}
