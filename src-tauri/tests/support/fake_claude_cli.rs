use super::*;
use agent_task_spawner::agent_launch::AgentLaunchOptions;
use agent_task_spawner::claude_session_policy::{ClaudeSessionFingerprint, ExecutableFingerprint};

pub(crate) const FAKE_CLAUDE_PY: &str = r#"
import json, os, subprocess, sys, threading, time
state_dir = sys.argv[1]
session_id = os.environ.get("FAKE_CLAUDE_SESSION", "sess-fixture-0001")
with open(os.path.join(state_dir, "cli.pid"), "a") as handle:
    handle.write(f"{os.getpid()}\n")
lock = threading.Lock()
busy = None
ignore_interrupt = False
finish_on_interrupt = False
hold_interrupt = False
cost = 0.0
result_index = 0
permission_answered = threading.Event()
SLEEPER = ("import os, sys, time; path = sys.argv[3]; "
           "open(path + '.tmp', 'w').write(str(os.getpid())); "
           "os.replace(path + '.tmp', path); time.sleep(300)")

def sleeper_argv(name):
    return [sys.executable, "-c", SLEEPER, "FAKE_CLAUDE_SLEEPER", state_dir, os.path.join(state_dir, name)]

def wait_for_pid_file(name):
    deadline = time.time() + 5
    while not os.path.exists(os.path.join(state_dir, name)) and time.time() < deadline:
        time.sleep(0.01)

def spawn_group_sleeper(name):
    subprocess.run(["/bin/sh", "-c", "\"$@\" </dev/null >/dev/null 2>&1 &", "sh"] + sleeper_argv(name), check=True)
    wait_for_pid_file(name)

def spawn_session_sleeper(name, stdout):
    subprocess.Popen(sleeper_argv(name), start_new_session=True, stdin=subprocess.DEVNULL,
                     stdout=stdout, stderr=subprocess.DEVNULL)
    wait_for_pid_file(name)

def emit(message):
    with lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

def lifecycle(uid, state):
    emit({"type": "command_lifecycle", "command_uuid": uid, "state": state})

def system(subtype, **fields):
    message = {"type": "system", "subtype": subtype, "session_id": session_id}
    message.update(fields)
    emit(message)

def assistant(text, uid=None):
    message = {"type": "assistant", "parent_tool_use_id": None, "session_id": session_id,
               "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}
    if uid is not None:
        message["user_message_uuid"] = uid
        message["user_message_uuids"] = [uid]
    emit(message)

def user_text(text):
    emit({"type": "user", "parent_tool_use_id": None, "session_id": session_id,
          "message": {"role": "user", "content": [{"type": "text", "text": text}]}})

def next_result_fields():
    global cost, result_index
    with lock:
        cost = round(cost + 0.01, 6)
        index = result_index
        result_index += 1
    return {"total_cost_usd": cost, "result_index": index}

def result(uid, subtype="success", text="ok"):
    ok = subtype == "success"
    message = {"type": "result", "subtype": subtype, "is_error": not ok, "num_turns": 1,
               "result": text if ok else "", "session_id": session_id,
               "stop_reason": "end_turn" if ok else "tool_use",
               "terminal_reason": "completed" if ok else "aborted_tools",
               "user_message_uuid": uid, "user_message_uuids": [uid]}
    message.update(next_result_fields())
    emit(message)

def unprompted_result(text):
    message = {"type": "result", "subtype": "success", "is_error": False, "num_turns": 1,
               "result": text, "session_id": session_id, "stop_reason": "end_turn",
               "terminal_reason": "completed", "origin": {"kind": "task-notification"}}
    message.update(next_result_fields())
    emit(message)

def native_drain(task, ask=False, hold=False):
    if hold:
        wait_for_release("release-drain")
    else:
        time.sleep(0.3)
    system("background_tasks_changed", tasks=[])
    system("task_updated", task_id=task, patch={"status": "completed"})
    system("task_notification", task_id=task, status="completed", output_file="/dev/null",
           summary="Background command completed (exit code 0)")
    system("init")
    if ask:
        emit({"type": "control_request", "request_id": "perm-bg-0001",
              "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {"command": "cat out.txt"},
                          "tool_use_id": "toolu-bg-0001"}})
        if not permission_answered.wait(10):
            return
    assistant("background-finished")
    unprompted_result("background-finished")

AGENT_TASK = "a4b355dcf6056a875"
AGENT_LAUNCH = "toolu_012nR5ST1SeGiHfvahNc1s2X"
AGENT_RESUME = "toolu_019eyG6GAy4aZoYrH76mTu6u"
AGENT_TITLE = "Live Codex model catalog like Claude"

def agent_started(tool):
    system("task_started", task_id=AGENT_TASK, tool_use_id=tool, description=AGENT_TITLE,
           task_type="local_agent", subagent_type="general-purpose")

def agent_progress(tool, description):
    system("task_progress", task_id=AGENT_TASK, tool_use_id=tool, description=description,
           last_tool_name="Bash", usage={"duration_ms": 1729706, "total_tokens": 330412, "tool_uses": 146})

def agent_finished(tool):
    system("task_updated", task_id=AGENT_TASK, patch={"status": "completed"})
    system("task_notification", task_id=AGENT_TASK, tool_use_id=tool, status="completed",
           usage={"duration_ms": 2021217, "total_tokens": 356341, "tool_uses": 161})

def subagent_text(tool, text):
    emit({"type": "assistant", "parent_tool_use_id": tool, "session_id": session_id,
          "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}})

def root_tool(tool, name, output):
    emit({"type": "assistant", "parent_tool_use_id": None, "session_id": session_id,
          "message": {"role": "assistant", "content": [{"type": "tool_use", "id": tool, "name": name, "input": {}}]}})
    return lambda: emit({"type": "user", "parent_tool_use_id": None, "session_id": session_id,
                         "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool,
                                                                  "content": output}]}})

def agent_resume():
    time.sleep(0.2)
    subagent_text(AGENT_LAUNCH, "first-run-progress")
    agent_progress(AGENT_LAUNCH, "Running Show changed files and sizes")
    agent_finished(AGENT_LAUNCH)
    system("init")
    resumed = root_tool(AGENT_RESUME, "SendMessage", "Resuming agent a4b355d")
    agent_started(AGENT_RESUME)
    resumed()
    agent_progress(AGENT_RESUME, AGENT_TITLE)
    assistant("agent-resumed")
    unprompted_result("agent-resumed")
    wait_for_release("release-agent")
    for index in range(3):
        subagent_text(AGENT_RESUME, f"idle-progress-{index}")
        agent_progress(AGENT_RESUME, "Running idle-progress")
    agent_finished(AGENT_RESUME)
    system("init")
    assistant("agent-finished")
    unprompted_result("agent-finished")

def wait_for_release(name):
    deadline = time.time() + 10
    while not os.path.exists(os.path.join(state_dir, name)) and time.time() < deadline:
        time.sleep(0.01)

def late_permission():
    time.sleep(0.3)
    emit({"type": "control_request", "request_id": "perm-late-0001",
          "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {"command": "ls"},
                      "tool_use_id": "toolu-late-0001"}})

def late_unsupported(count):
    time.sleep(0.3)
    for index in range(count):
        emit({"type": "control_request", "request_id": f"hook-late-{index:04d}",
              "request": {"subtype": "hook_callback", "callback_id": "cb-late"}})

def interrupt(frame):
    global busy
    request_id = frame.get("request_id")
    with open(os.path.join(state_dir, "interrupts.log"), "a") as handle:
        handle.write(f"{request_id}\n")
    if hold_interrupt:
        wait_for_release("release-interrupt")
    emit({"type": "control_response",
          "response": {"subtype": "success", "request_id": request_id, "response": {"still_queued": []}}})
    if busy is None or ignore_interrupt:
        return
    uid, task = busy
    busy = None
    if finish_on_interrupt:
        system("task_notification", task_id=task, status="completed", output_file="/dev/null",
               summary="Command completed")
        assistant("finished-before-interrupt", uid)
        result(uid, text="finished-before-interrupt")
        lifecycle(uid, "completed")
        return
    if task is not None:
        system("task_notification", task_id=task, status="stopped", output_file="/dev/null",
               summary="Command was stopped")
    emit({"type": "user", "parent_tool_use_id": None, "session_id": session_id,
          "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu-slow",
                                                   "is_error": True,
                                                   "content": "The user doesn't want to proceed with this tool use."}]}})
    user_text("[Request interrupted by user for tool use]")
    result(uid, subtype="error_during_execution")
    lifecycle(uid, "cancelled")

for raw in sys.stdin:
    try:
        frame = json.loads(raw)
    except ValueError:
        continue
    kind = frame.get("type")
    if kind == "control_response":
        with open(os.path.join(state_dir, "control_responses.log"), "a") as handle:
            handle.write(raw)
        permission_answered.set()
        continue
    if kind == "control_request":
        if (frame.get("request") or {}).get("subtype") == "interrupt":
            interrupt(frame)
        continue
    if kind != "user":
        continue
    uid = frame.get("uuid", "")
    content = frame["message"]["content"]
    text = content if isinstance(content, str) else "".join(block.get("text", "") for block in content if block.get("type") == "text")
    if text.startswith("cancel-queued"):
        lifecycle(uid, "queued")
        lifecycle(uid, "cancelled")
        continue
    lifecycle(uid, "queued")
    lifecycle(uid, "started")
    system("init")
    assistant("echo:" + text, uid)
    if text.startswith("crash"):
        os._exit(9)
    if text.startswith("close-stdout"):
        sys.stdout.flush()
        os.close(1)
        continue
    if text.startswith("spawn-background"):
        spawn_group_sleeper("background.pid")
    if text.startswith("spawn-detached"):
        spawn_session_sleeper("detached.pid", subprocess.DEVNULL)
    if text.startswith("close-stdin"):
        os.close(0)
        open(os.path.join(state_dir, "stdin.closed"), "w").close()
        time.sleep(60)
        continue
    if text.startswith("malformed-control"):
        with lock:
            sys.stdout.write('{"type": "control_request", "request_id": "bad-0001", "request": {\n')
            sys.stdout.flush()
        continue
    if text.startswith("oversized-frame"):
        system("status", padding="x" * (1100 * 1024))
        continue
    if text.startswith("stall-stdin"):
        wait_for_release("release-result")
        result(uid)
        lifecycle(uid, "completed")
        wait_for_release("release-stdin")
        continue
    if text.startswith("big-result"):
        result(uid, text="x" * (600 * 1024))
        lifecycle(uid, "completed")
        open(os.path.join(state_dir, "big.done"), "w").close()
        continue
    if text.startswith("orphan-stdout"):
        result(uid)
        lifecycle(uid, "completed")
        spawn_session_sleeper("detached.pid", None)
        time.sleep(0.2)
        system("init")
        assistant("dangling")
        sys.stdout.flush()
        os._exit(0)
    if text.startswith("native-linger"):
        task = "linger-" + uid[:8]
        system("background_tasks_changed", tasks=[{"task_id": task, "task_type": "local_bash", "description": "sleep"}])
        system("task_started", task_id=task, tool_use_id="toolu-linger", description="sleep",
               is_backgrounded=True, task_type="local_bash")
        emit({"type": "user", "parent_tool_use_id": None, "session_id": session_id,
              "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu-linger",
                                                       "content": "Command running in background"}]}})
        assistant("still-working")
        busy = (uid, None)
        ignore_interrupt = False
        continue
    if text.startswith("slow"):
        task = "slow-" + uid[:8]
        system("task_started", task_id=task, tool_use_id="toolu-slow", description="slow",
               is_backgrounded=False, task_type="local_bash")
        busy = (uid, task)
        ignore_interrupt = text.startswith("slow-ignore")
        finish_on_interrupt = text.startswith("slow-finish")
        hold_interrupt = text.startswith("slow-held")
        continue
    if text.startswith("native-background") or text.startswith("native-held"):
        task = "native-" + uid[:8]
        system("background_tasks_changed", tasks=[{"task_id": task, "task_type": "local_bash", "description": "sleep"}])
        system("task_started", task_id=task, tool_use_id="toolu-native", description="sleep",
               is_backgrounded=True, task_type="local_bash")
        emit({"type": "user", "parent_tool_use_id": None, "session_id": session_id,
              "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu-native",
                                                       "content": "Command running in background"}]}})
        assistant("started")
        result(uid, text="started")
        lifecycle(uid, "completed")
        ask = text.startswith("native-background-permission")
        hold = text.startswith("native-held")
        threading.Thread(target=native_drain, args=(task, ask, hold), daemon=True).start()
        continue
    if text.startswith("agent-resume"):
        launched = root_tool(AGENT_LAUNCH, "Agent", "Async agent launched successfully.")
        agent_started(AGENT_LAUNCH)
        launched()
        assistant("agent-launched", uid)
        result(uid, text="agent-launched")
        lifecycle(uid, "completed")
        threading.Thread(target=agent_resume, daemon=True).start()
        continue
    if text.startswith("error-result"):
        result(uid, subtype="error_max_turns")
        lifecycle(uid, "completed")
        continue
    result(uid)
    lifecycle(uid, "completed")
    if text.startswith("late-permission"):
        threading.Thread(target=late_permission, daemon=True).start()
    if text.startswith("late-unsupported"):
        count = 17 if text.startswith("late-unsupported-flood") else 1
        threading.Thread(target=late_unsupported, args=(count,), daemon=True).start()
"#;

pub(crate) struct FakeCli {
    pub(crate) dir: PathBuf,
    python: PathBuf,
}

impl FakeCli {
    pub(crate) fn new(label: &str) -> Self {
        let dir = unique_path(label);
        fs::create_dir_all(&dir).expect("fake cli directory");
        let python = probe_binary(&[
            "/usr/bin/python3",
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
        ])
        .expect("python3 for the fake Claude CLI");
        Self { dir, python }
    }

    pub(crate) fn plan(&self, session_id: &str, prompt: &str) -> AgentTaskSpawnPlan {
        AgentTaskSpawnPlan::for_tests(
            self.python.clone(),
            vec![
                "-u".to_string(),
                "-c".to_string(),
                FAKE_CLAUDE_PY.to_string(),
                self.dir.to_string_lossy().into_owned(),
            ],
            self.dir.clone(),
            vec![
                ("FAKE_CLAUDE_SESSION".to_string(), session_id.to_string()),
                ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ],
        )
        .with_stdin_frame_for_tests(claude_user_frame(prompt, &[]))
    }

    pub(crate) fn fingerprint(
        &self,
        generation: u64,
        launch: AgentLaunchOptions,
    ) -> ClaudeSessionFingerprint {
        ClaudeSessionFingerprint {
            executable: ExecutableFingerprint {
                path: self.python.clone(),
                size_bytes: 0,
                modified_epoch_ms: 0,
                device: 0,
                inode: 0,
            },
            provider_generation: generation,
            launch,
            args_without_resume: vec!["fake".to_string()],
            env: Vec::new(),
            cwd: self.dir.clone(),
            cwd_identity: None,
        }
    }

    pub(crate) fn cli_pids(&self) -> Vec<i32> {
        fs::read_to_string(self.dir.join("cli.pid"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }

    pub(crate) fn background_pid(&self) -> Option<i32> {
        self.pid_file("background.pid")
    }

    pub(crate) fn detached_pid(&self) -> Option<i32> {
        self.pid_file("detached.pid")
    }

    pub(crate) fn interrupts_received(&self) -> usize {
        fs::read_to_string(self.dir.join("interrupts.log"))
            .unwrap_or_default()
            .lines()
            .count()
    }

    pub(crate) fn control_responses(&self) -> String {
        fs::read_to_string(self.dir.join("control_responses.log")).unwrap_or_default()
    }

    pub(crate) fn stdin_closed(&self) -> bool {
        self.dir.join("stdin.closed").exists()
    }

    pub(crate) fn release_native_drain(&self) {
        fs::write(self.dir.join("release-drain"), b"").expect("release the native drain");
    }

    pub(crate) fn release_agent(&self) {
        fs::write(self.dir.join("release-agent"), b"").expect("release the resumed agent");
    }

    pub(crate) fn big_result_written(&self) -> bool {
        self.dir.join("big.done").exists()
    }

    fn pid_file(&self, name: &str) -> Option<i32> {
        fs::read_to_string(self.dir.join(name))
            .ok()
            .and_then(|text| text.trim().parse().ok())
    }
}

impl Drop for FakeCli {
    fn drop(&mut self) {
        let marker = self.dir.to_string_lossy().into_owned();
        let sleeper_marker = format!("FAKE_CLAUDE_SLEEPER {marker}");
        let owned = self
            .cli_pids()
            .into_iter()
            .map(|pid| (pid, marker.as_str()));
        let sleepers = self
            .background_pid()
            .into_iter()
            .chain(self.detached_pid())
            .map(|pid| (pid, sleeper_marker.as_str()));
        for (pid, expected) in owned.chain(sleepers) {
            kill_if_command_matches(pid, expected);
        }
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn kill_if_command_matches(pid: i32, expected: &str) {
    if pid <= 1 {
        return;
    }
    let Ok(listing) = std::process::Command::new("/bin/ps")
        .args(["-ww", "-o", "command=", "-p", &pid.to_string()])
        .output()
    else {
        return;
    };
    if !String::from_utf8_lossy(&listing.stdout).contains(expected) {
        return;
    }
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
}

pub(crate) fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

pub(crate) fn gone_within(pid: i32, timeout: Duration) -> bool {
    wait_until(timeout, || !alive(pid))
}
