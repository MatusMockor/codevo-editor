use super::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;
use super::claude_background_line::background_line;
use super::claude_session_task_stop::{PendingTaskStops, TaskStopReply};
use crate::agent_task_supervisor::agent_task_result_detector::{
    failed_result, lifecycle_candidate, ResultLineDetector, ResultSettlePolicy,
};
pub use crate::agent_task_supervisor::agent_task_result_detector::{
    BackgroundTaskKind, LiveBackgroundTask,
};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Arc;

pub const MAX_ROUTED_LINE_BYTES: usize = 1024 * 1024;
pub const MAX_BACKGROUND_TURN_BYTES: usize = 256 * 1024;
pub const BACKGROUND_RESULT_RESERVE_BYTES: usize = 64 * 1024;
pub const BACKGROUND_ANSWER_RESERVE_BYTES: usize = 32 * 1024;
pub const MAX_REPORTED_BACKGROUND_TASKS: usize = 32;
const OVERSIZED_FRAME_ERROR: &str = "Claude session frame exceeded its size limit.";
const COST_FIELD: &str = "total_cost_usd";
const PROCESS_COST_FIELD: &str = "codevo_process_total_cost_usd";
const COST_TOLERANCE: f64 = 1e-9;
const MAX_BACKGROUND_PERMISSION_DENIALS: usize = 16;
const MAX_UNOWNED_CONTROL_ANSWERS: usize = 16;
const MAX_CONTROL_REQUEST_ID_BYTES: usize = 128;
const MAX_OWNED_RUNS: usize = 256;
const MAX_RUN_ID_BYTES: usize = 256;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClaudeBackgroundTurn {
    pub output: Vec<u8>,
    pub truncated: bool,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClaudeBackgroundReply {
    #[default]
    None,
    InProgress,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClaudeBackgroundTasks {
    pub tasks: Vec<LiveBackgroundTask>,
    pub total: usize,
    pub agents: usize,
    pub reply: ClaudeBackgroundReply,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RouterStep {
    pub turn_output: Vec<u8>,
    pub settled: bool,
    pub interrupted: bool,
    pub cancelled: bool,
    pub result_failed: bool,
    pub interrupt_acknowledged: bool,
    pub unowned_activity: bool,
    pub background_turns: Vec<ClaudeBackgroundTurn>,
    pub background_tasks: Option<ClaudeBackgroundTasks>,
    pub permission_denials: Vec<String>,
    pub unsupported_requests: Vec<String>,
    pub failure: Option<&'static str>,
}

struct AttachedTurn {
    lifecycle: Arc<ClaudeInputLifecycle>,
    command_id: String,
    started: bool,
    result_seen: bool,
    init_expected: bool,
    running: Option<String>,
    interrupting: bool,
    interrupt_evidence: bool,
    cancelled: bool,
    result_failed: bool,
    runs: OwnedRuns,
}

struct OwnedRun {
    task: String,
    tool: Option<String>,
}

#[derive(Default)]
struct OwnedRuns {
    runs: VecDeque<OwnedRun>,
}

impl OwnedRuns {
    fn claim(&mut self, message: &Value, live: impl Fn(&str) -> bool) {
        let Some(task) = run_id(message.get("task_id")) else {
            return;
        };
        self.release(task);
        if self.runs.len() == MAX_OWNED_RUNS {
            let finished = self.runs.iter().position(|run| !live(&run.task));
            self.runs.remove(finished.unwrap_or(0));
        }
        self.runs.push_back(OwnedRun {
            task: task.to_string(),
            tool: run_id(message.get("tool_use_id")).map(str::to_string),
        });
    }

    fn release(&mut self, task: &str) {
        self.runs.retain(|run| run.task != task);
    }

    fn owns(&self, message: &Value) -> bool {
        if let Some(parent) = message.get("parent_tool_use_id").and_then(Value::as_str) {
            return self
                .runs
                .iter()
                .any(|run| run.tool.as_deref() == Some(parent));
        }
        let Some(task) = task_frame(message).and_then(|_| run_id(message.get("task_id"))) else {
            return false;
        };
        let tool = run_id(message.get("tool_use_id"));
        self.runs
            .iter()
            .any(|run| run.task == task && same_run(run.tool.as_deref(), tool))
    }
}

#[derive(Default)]
struct UnsolicitedTurn {
    output: Vec<u8>,
    truncated: bool,
    denials: usize,
    unsupported_answers: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BudgetClass {
    Closing,
    Answer,
    Activity,
}

impl BudgetClass {
    fn of(message: &Value) -> Self {
        if root_result(message) {
            return Self::Closing;
        }
        if root_answer(message) {
            return Self::Answer;
        }
        Self::Activity
    }

    fn limit(self) -> usize {
        match self {
            Self::Closing => MAX_BACKGROUND_TURN_BYTES,
            Self::Answer => MAX_BACKGROUND_TURN_BYTES - BACKGROUND_RESULT_RESERVE_BYTES,
            Self::Activity => {
                MAX_BACKGROUND_TURN_BYTES
                    - BACKGROUND_RESULT_RESERVE_BYTES
                    - BACKGROUND_ANSWER_RESERVE_BYTES
            }
        }
    }
}

impl UnsolicitedTurn {
    fn push(&mut self, line: &[u8], class: BudgetClass) -> bool {
        if self.output.len() + line.len() > class.limit() {
            self.truncated = true;
            return false;
        }
        self.output.extend_from_slice(line);
        true
    }

    fn finish(self, complete: bool) -> ClaudeBackgroundTurn {
        ClaudeBackgroundTurn {
            output: self.output,
            truncated: self.truncated,
            complete,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Destination {
    Turn,
    Command,
    Unsolicited,
    Background,
    Discard,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LineMode {
    Buffering,
    Streaming,
    Skipping,
}

pub struct ClaudeSessionRouter {
    detector: ResultLineDetector,
    attached: Option<AttachedTurn>,
    lifecycle_supported: bool,
    unsolicited: Option<UnsolicitedTurn>,
    pending_interrupt: Option<String>,
    cost_baseline: f64,
    idle_unsupported_answers: usize,
    background_revision: u64,
    background_offer_pending: bool,
    reported_background: ClaudeBackgroundTasks,
    task_stops: PendingTaskStops,
    line: Vec<u8>,
    mode: LineMode,
}

impl Default for ClaudeSessionRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeSessionRouter {
    pub fn new() -> Self {
        Self {
            detector: ResultLineDetector::new()
                .with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork),
            attached: None,
            lifecycle_supported: false,
            unsolicited: None,
            pending_interrupt: None,
            cost_baseline: 0.0,
            idle_unsupported_answers: 0,
            background_revision: 0,
            background_offer_pending: false,
            reported_background: ClaudeBackgroundTasks::default(),
            task_stops: PendingTaskStops::default(),
            line: Vec::new(),
            mode: LineMode::Buffering,
        }
    }

    pub fn attach(&mut self, lifecycle: Arc<ClaudeInputLifecycle>) {
        self.detector.rearm(Some(Arc::clone(&lifecycle)));
        let command_id = lifecycle.initial_command_id().to_string();
        self.attached = Some(AttachedTurn {
            running: Some(command_id.clone()),
            command_id,
            lifecycle,
            started: false,
            result_seen: false,
            init_expected: false,
            interrupting: false,
            interrupt_evidence: false,
            cancelled: false,
            result_failed: false,
            runs: OwnedRuns::default(),
        });
        self.pending_interrupt = None;
        self.idle_unsupported_answers = 0;
    }

    pub fn detach(&mut self) {
        self.detector.rearm(None);
        self.attached = None;
        self.pending_interrupt = None;
        self.idle_unsupported_answers = 0;
    }

    pub fn interrupt_sent(&mut self, request_id: String) {
        self.pending_interrupt = Some(request_id);
        self.detector.suspend_drain_settlement();
        if let Some(turn) = self.attached.as_mut() {
            turn.interrupting = true;
        }
    }

    pub fn withdraw_interrupt(&mut self, request_id: &str) {
        if self.pending_interrupt.as_deref() != Some(request_id) {
            return;
        }
        self.pending_interrupt = None;
        self.detector.resume_drain_settlement();
        if let Some(turn) = self.attached.as_mut() {
            turn.interrupting = false;
            turn.interrupt_evidence = false;
        }
    }

    pub fn settle_finished_foreground(&mut self) -> Option<RouterStep> {
        let finished = self
            .attached
            .as_ref()
            .is_some_and(|turn| turn.result_seen && turn.running.is_none() && !turn.interrupting);
        if !finished || !self.detector.settle_finished_foreground() {
            return None;
        }
        let result_failed = self.attached_result_failed();
        self.detach();
        Some(RouterStep {
            settled: true,
            result_failed,
            ..RouterStep::default()
        })
    }

    fn attached_result_failed(&self) -> bool {
        self.attached
            .as_ref()
            .is_some_and(|turn| turn.result_failed)
    }

    pub fn conversation(&self) -> Option<&str> {
        self.detector.session_id()
    }

    pub fn live_background_tasks(&self) -> usize {
        self.detector.live_background_task_count()
    }

    pub fn live_background_task(&self, task_id: &str) -> bool {
        self.detector.has_live_background_task(task_id)
    }

    pub fn begin_task_stop(&mut self, request_id: String) -> bool {
        self.task_stops.begin(request_id)
    }

    pub fn take_task_stop_reply(&mut self, request_id: &str) -> Option<TaskStopReply> {
        self.task_stops.take(request_id)
    }

    pub fn withdraw_task_stop(&mut self, request_id: &str) {
        self.task_stops.withdraw(request_id);
    }

    pub fn background_tasks(&self) -> ClaudeBackgroundTasks {
        let live = self.detector.background_tasks();
        let agents = live
            .iter()
            .filter(|task| task.kind == BackgroundTaskKind::Agent)
            .count();
        let total = live.len();
        let tasks = live
            .into_iter()
            .take(MAX_REPORTED_BACKGROUND_TASKS)
            .collect();
        ClaudeBackgroundTasks {
            tasks,
            total,
            agents,
            reply: self.reply(),
        }
    }

    fn reply(&self) -> ClaudeBackgroundReply {
        match self.unsolicited {
            Some(_) => ClaudeBackgroundReply::InProgress,
            None => ClaudeBackgroundReply::None,
        }
    }

    pub fn is_attached_to(&self, lifecycle: &Arc<ClaudeInputLifecycle>) -> bool {
        self.attached
            .as_ref()
            .is_some_and(|turn| Arc::ptr_eq(&turn.lifecycle, lifecycle))
    }

    pub fn feed(&mut self, chunk: &[u8]) -> RouterStep {
        let mut step = RouterStep::default();
        let mut rest = chunk;
        while !rest.is_empty() && step.failure.is_none() {
            let end = rest
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(rest.len(), |newline| newline + 1);
            let (piece, remaining) = rest.split_at(end);
            rest = remaining;
            self.absorb(piece, piece.ends_with(b"\n"), &mut step);
        }
        step.background_tasks = self.background_change();
        step
    }

    pub fn forget_reported_background(&mut self) {
        self.reported_background = ClaudeBackgroundTasks::default();
        self.background_offer_pending = true;
    }

    fn background_change(&mut self) -> Option<ClaudeBackgroundTasks> {
        let revision = self.detector.background_revision();
        let refused = std::mem::take(&mut self.background_offer_pending);
        if !refused
            && revision == self.background_revision
            && self.reply() == self.reported_background.reply
        {
            return None;
        }
        self.background_revision = revision;
        let current = self.background_tasks();
        if !refused && current == self.reported_background {
            return None;
        }
        self.reported_background = current.clone();
        Some(current)
    }

    pub fn finish(&mut self) -> RouterStep {
        let mut step = RouterStep::default();
        let partial = std::mem::take(&mut self.line);
        let mode = std::mem::replace(&mut self.mode, LineMode::Buffering);
        let dangling = !partial.is_empty();
        if mode == LineMode::Buffering && self.owned() {
            step.turn_output = partial;
        }
        if let Some(mut active) = self.unsolicited.take() {
            active.truncated |= dangling;
            step.background_turns.push(active.finish(false));
        }
        step.background_tasks = self.background_change();
        step
    }

    fn absorb(&mut self, piece: &[u8], complete: bool, step: &mut RouterStep) {
        let next = match complete {
            true => LineMode::Buffering,
            false => self.mode,
        };
        match self.mode {
            LineMode::Streaming => {
                step.turn_output.extend_from_slice(piece);
                self.mode = next;
                return;
            }
            LineMode::Skipping => {
                self.mode = next;
                return;
            }
            LineMode::Buffering => {}
        }
        self.line.extend_from_slice(piece);
        if self.line.len() - usize::from(complete) > MAX_ROUTED_LINE_BYTES {
            self.overflow(complete, step);
            return;
        }
        if !complete {
            return;
        }
        let line = std::mem::take(&mut self.line);
        self.route_line(line, step);
    }

    fn overflow(&mut self, complete: bool, step: &mut RouterStep) {
        let prefix = std::mem::take(&mut self.line);
        self.mode = match complete {
            true => LineMode::Buffering,
            false => LineMode::Skipping,
        };
        if lifecycle_candidate(&prefix) {
            step.failure = Some(OVERSIZED_FRAME_ERROR);
            return;
        }
        if self.owned() {
            step.turn_output.extend_from_slice(&prefix);
            self.mode = match complete {
                true => LineMode::Buffering,
                false => LineMode::Streaming,
            };
            return;
        }
        if let Some(active) = self.unsolicited.as_mut() {
            active.truncated = true;
        }
    }

    fn route_line(&mut self, line: Vec<u8>, step: &mut RouterStep) {
        let Ok(message) = serde_json::from_slice::<Value>(&line) else {
            if let Some(active) = self.unsolicited.as_mut() {
                active.truncated = true;
                return;
            }
            let destination = self.attached_destination();
            self.deliver(destination, line, BudgetClass::Activity, step);
            return;
        };
        if self.acknowledges_interrupt(&message) {
            step.interrupt_acknowledged = true;
        }
        if self.detector.expire_level_ended(&message) && self.owned() {
            if let (true, via_interrupt) = self.settle_ready() {
                self.record_settlement(via_interrupt, step);
            }
        }
        let finishes_command = self.finishes_attached_command(&message);
        let destination = self.classify(&message, step);
        let owned = self.owned();
        self.note_run(destination, owned, &message);
        let outcome = match destination {
            Destination::Turn | Destination::Command if owned => {
                self.detector.consume_message(&message)
            }
            Destination::Command => self.detector.observe_command(&message).map(|()| false),
            _ => self.detector.track_message(&message).map(|()| false),
        };
        let ends_unsolicited = destination == Destination::Unsolicited && root_result(&message);
        self.forward(destination, message, line, step);
        if ends_unsolicited {
            self.emit_unsolicited(true, step);
        }
        let natural = match outcome {
            Ok(settled) => settled,
            Err(error) => {
                step.failure = Some(error);
                return;
            }
        };
        if finishes_command {
            self.detector.command_finished();
        }
        let (settled, via_interrupt) = match natural {
            true => (true, false),
            false if self.owned() => self.settle_ready(),
            false => (false, false),
        };
        if settled {
            self.record_settlement(via_interrupt, step);
        }
    }

    fn forward(
        &mut self,
        destination: Destination,
        message: Value,
        line: Vec<u8>,
        step: &mut RouterStep,
    ) {
        let class = BudgetClass::of(&message);
        let line = match destination {
            Destination::Unsolicited => background_line(&message, line),
            _ => Some(line),
        };
        let Some(line) = line else {
            return;
        };
        let (line, process_total) = self.normalize_cost(destination, message, line);
        let accepted = self.deliver(destination, line, class, step);
        if let (true, Some(total)) = (accepted, process_total) {
            self.cost_baseline = total;
        }
    }

    fn record_settlement(&mut self, via_interrupt: bool, step: &mut RouterStep) {
        step.settled = true;
        step.interrupted = self
            .attached
            .as_ref()
            .is_some_and(|turn| turn.interrupting && (via_interrupt || turn.interrupt_evidence));
        step.cancelled = !step.interrupted
            && self
                .attached
                .as_ref()
                .is_some_and(|turn| turn.cancelled && !turn.result_seen);
        step.result_failed = !step.interrupted && !step.cancelled && self.attached_result_failed();
        self.detach();
    }

    fn classify(&mut self, message: &Value, step: &mut RouterStep) -> Destination {
        let kind = message.get("type").and_then(Value::as_str);
        let root = message.get("parent_tool_use_id").is_none_or(Value::is_null);
        if kind == Some("command_lifecycle") {
            return self.classify_lifecycle(message, step);
        }
        if kind == Some("control_response") && self.task_stops.resolve(message) {
            return Destination::Discard;
        }
        if kind == Some("control_response") {
            return self.attached_destination();
        }
        if kind == Some("control_request") && root {
            return self.classify_control_request(message, step);
        }
        if root_result(message) && self.names_our_result(message) {
            self.emit_unsolicited(false, step);
            if let Some(turn) = self.attached.as_mut() {
                turn.started = true;
                turn.result_seen = true;
                turn.init_expected = false;
                turn.result_failed = failed_result(message);
                turn.interrupt_evidence |= turn.interrupting && turn.result_failed;
                let finished = turn
                    .running
                    .as_deref()
                    .is_some_and(|running| result_names(message, running));
                if finished || !self.lifecycle_supported {
                    turn.running = None;
                }
            }
            return Destination::Turn;
        }
        if self.unsolicited.is_some() {
            return match self.attached_run_owns(message) {
                true => Destination::Turn,
                false => Destination::Unsolicited,
            };
        }
        if self.owned() {
            return self.classify_owned(kind, message);
        }
        if root && opens_activity(kind, message) {
            self.unsolicited = Some(UnsolicitedTurn::default());
            return Destination::Unsolicited;
        }
        self.attached_destination()
    }

    fn attached_run_owns(&self, message: &Value) -> bool {
        self.attached
            .as_ref()
            .is_some_and(|turn| turn.runs.owns(message))
    }

    fn note_run(&mut self, destination: Destination, owned: bool, message: &Value) {
        if task_frame(message) != Some("task_started") {
            return;
        }
        let claimed = destination == Destination::Turn && (owned || self.unsolicited.is_some());
        let detector = &self.detector;
        let Some(turn) = self.attached.as_mut() else {
            return;
        };
        if claimed {
            turn.runs
                .claim(message, |task| detector.has_live_background_task(task));
            return;
        }
        if let Some(task) = run_id(message.get("task_id")) {
            turn.runs.release(task);
        }
    }

    fn classify_control_request(&mut self, message: &Value, step: &mut RouterStep) -> Destination {
        if self.owned() {
            return Destination::Turn;
        }
        if let Some(request_id) = self.background_permission(message) {
            step.permission_denials.push(request_id);
            return Destination::Unsolicited;
        }
        let Some(request_id) = self.unsupported_request(message) else {
            step.unowned_activity = true;
            return Destination::Discard;
        };
        step.unsupported_requests.push(request_id);
        match self.unsolicited {
            Some(_) => Destination::Unsolicited,
            None => Destination::Discard,
        }
    }

    fn classify_owned(&mut self, kind: Option<&str>, message: &Value) -> Destination {
        if root_result(message) {
            return Destination::Background;
        }
        let root_init = kind == Some("system")
            && message.get("subtype").and_then(Value::as_str) == Some("init")
            && message.get("parent_tool_use_id").is_none_or(Value::is_null);
        let Some(turn) = self.attached.as_mut().filter(|_| root_init) else {
            return Destination::Turn;
        };
        if turn.result_seen && !turn.init_expected {
            self.unsolicited = Some(UnsolicitedTurn::default());
            return Destination::Unsolicited;
        }
        turn.init_expected = false;
        Destination::Turn
    }

    fn classify_lifecycle(&mut self, message: &Value, step: &mut RouterStep) -> Destination {
        self.lifecycle_supported = true;
        let id = message
            .get("command_uuid")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(turn) = self.attached.as_mut() else {
            return Destination::Discard;
        };
        if !turn.lifecycle.names_command(id) {
            return Destination::Discard;
        }
        let state = message.get("state").and_then(Value::as_str);
        if matches!(state, Some("completed" | "cancelled")) {
            turn.started |= id == turn.command_id;
            turn.interrupt_evidence |= turn.interrupting && state == Some("cancelled");
            turn.cancelled |= state == Some("cancelled")
                && id == turn.command_id
                && !turn.interrupting
                && !turn.result_seen;
            if turn.running.as_deref() == Some(id) {
                turn.running = None;
            }
            return Destination::Command;
        }
        if state != Some("started") {
            return Destination::Command;
        }
        turn.running = Some(id.to_string());
        turn.started |= id == turn.command_id;
        turn.init_expected = true;
        self.emit_unsolicited(false, step);
        Destination::Command
    }

    fn finishes_attached_command(&self, message: &Value) -> bool {
        let Some(turn) = self.attached.as_ref() else {
            return false;
        };
        message.get("type").and_then(Value::as_str) == Some("command_lifecycle")
            && message.get("command_uuid").and_then(Value::as_str) == Some(&turn.command_id)
            && matches!(
                message.get("state").and_then(Value::as_str),
                Some("completed" | "cancelled")
            )
    }

    fn settle_ready(&mut self) -> (bool, bool) {
        let interrupted = self
            .attached
            .as_ref()
            .is_some_and(|turn| turn.interrupting && turn.running.is_none());
        if interrupted {
            return (self.detector.settle_interrupted(), true);
        }
        (self.detector.settle_if_ready(), false)
    }

    fn names_our_result(&self, message: &Value) -> bool {
        let Some(turn) = self.attached.as_ref() else {
            return false;
        };
        let uuid = message.get("user_message_uuid");
        let uuids = message.get("user_message_uuids");
        let named = uuid
            .into_iter()
            .chain(uuids.and_then(Value::as_array).into_iter().flatten())
            .filter_map(Value::as_str)
            .any(|id| turn.lifecycle.names_command(id));
        if named {
            return true;
        }
        !self.lifecycle_supported
            && self.unsolicited.is_none()
            && uuid.is_none()
            && uuids.is_none()
            && message.pointer("/origin/kind").is_none()
    }

    fn background_permission(&mut self, message: &Value) -> Option<String> {
        let active = self.unsolicited.as_mut()?;
        if message.pointer("/request/subtype").and_then(Value::as_str) != Some("can_use_tool")
            || active.denials >= MAX_BACKGROUND_PERMISSION_DENIALS
        {
            return None;
        }
        let request_id = message
            .get("request_id")
            .and_then(Value::as_str)
            .filter(|id| valid_request_id(id))?;
        active.denials += 1;
        Some(request_id.to_string())
    }

    fn unsupported_request(&mut self, message: &Value) -> Option<String> {
        if message.pointer("/request/subtype").and_then(Value::as_str) == Some("can_use_tool") {
            return None;
        }
        let request_id = message
            .get("request_id")
            .and_then(Value::as_str)
            .filter(|id| valid_request_id(id))?;
        let answered = match self.unsolicited.as_mut() {
            Some(active) => &mut active.unsupported_answers,
            None => &mut self.idle_unsupported_answers,
        };
        if *answered >= MAX_UNOWNED_CONTROL_ANSWERS {
            return None;
        }
        *answered += 1;
        Some(request_id.to_string())
    }

    fn owned(&self) -> bool {
        self.unsolicited.is_none()
            && self
                .attached
                .as_ref()
                .is_some_and(|turn| turn.started || !self.lifecycle_supported)
    }

    fn attached_destination(&self) -> Destination {
        match self.attached {
            Some(_) => Destination::Turn,
            None => Destination::Discard,
        }
    }

    fn deliver(
        &mut self,
        destination: Destination,
        line: Vec<u8>,
        class: BudgetClass,
        step: &mut RouterStep,
    ) -> bool {
        match destination {
            Destination::Turn | Destination::Command => {
                step.turn_output.extend_from_slice(&line);
                true
            }
            Destination::Unsolicited => self
                .unsolicited
                .as_mut()
                .is_some_and(|active| active.push(&line, class)),
            Destination::Background => {
                let mut turn = UnsolicitedTurn::default();
                let accepted = turn.push(&line, BudgetClass::Closing);
                step.background_turns.push(turn.finish(true));
                accepted
            }
            Destination::Discard => false,
        }
    }

    fn emit_unsolicited(&mut self, complete: bool, step: &mut RouterStep) {
        if let Some(active) = self.unsolicited.take() {
            step.background_turns.push(active.finish(complete));
        }
    }

    fn normalize_cost(
        &mut self,
        destination: Destination,
        message: Value,
        line: Vec<u8>,
    ) -> (Vec<u8>, Option<f64>) {
        if destination == Destination::Discard || !root_result(&message) {
            return (line, None);
        }
        let Some(total) = message
            .get(COST_FIELD)
            .and_then(Value::as_f64)
            .filter(|total| total.is_finite() && *total >= 0.0)
        else {
            return (line, None);
        };
        let Value::Object(mut fields) = message else {
            return (line, None);
        };
        let delta = total - self.cost_baseline;
        fields.remove(COST_FIELD);
        if delta >= -COST_TOLERANCE {
            fields.insert(COST_FIELD.to_string(), Value::from(delta.max(0.0)));
        }
        fields.insert(PROCESS_COST_FIELD.to_string(), Value::from(total));
        let Ok(mut rewritten) = serde_json::to_vec(&Value::Object(fields)) else {
            return (line, None);
        };
        rewritten.push(b'\n');
        (rewritten, Some(total))
    }

    fn acknowledges_interrupt(&mut self, message: &Value) -> bool {
        if message.get("type").and_then(Value::as_str) != Some("control_response") {
            return false;
        }
        let id = message
            .pointer("/response/request_id")
            .and_then(Value::as_str);
        if id.is_none() || id != self.pending_interrupt.as_deref() {
            return false;
        }
        self.pending_interrupt = None;
        true
    }
}

fn result_names(message: &Value, id: &str) -> bool {
    message.get("user_message_uuid").and_then(Value::as_str) == Some(id)
        || message
            .get("user_message_uuids")
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|named| named.as_str() == Some(id)))
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_CONTROL_REQUEST_ID_BYTES
        && id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"_.:-".contains(&byte))
        })
}

fn root_result(message: &Value) -> bool {
    message.get("type").and_then(Value::as_str) == Some("result")
        && message.get("parent_tool_use_id").is_none_or(Value::is_null)
}

fn run_id(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= MAX_RUN_ID_BYTES)
}

fn same_run(claimed: Option<&str>, named: Option<&str>) -> bool {
    match (claimed, named) {
        (Some(claimed), Some(named)) => claimed == named,
        _ => true,
    }
}

fn task_frame(message: &Value) -> Option<&str> {
    if message.get("type").and_then(Value::as_str) != Some("system") {
        return None;
    }
    message
        .get("subtype")
        .and_then(Value::as_str)
        .filter(|subtype| {
            matches!(
                *subtype,
                "task_started" | "task_progress" | "task_notification" | "task_updated"
            )
        })
}

fn root_answer(message: &Value) -> bool {
    message.get("type").and_then(Value::as_str) == Some("assistant")
        && message.get("parent_tool_use_id").is_none_or(Value::is_null)
        && message
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|block| block.get("type").and_then(Value::as_str) == Some("text"))
}

fn opens_activity(kind: Option<&str>, message: &Value) -> bool {
    match kind {
        Some("assistant" | "user" | "stream_event" | "result") => true,
        Some("system") => message.get("subtype").and_then(Value::as_str) == Some("init"),
        _ => false,
    }
}

#[cfg(test)]
#[path = "claude_session_router_tests.rs"]
mod tests;
