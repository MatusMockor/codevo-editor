import { describe, expect, it } from "vitest";
import { defaultAgentLaunchOptions } from "./agentLaunch";
import {
  failureMessageOf,
  validateStartAgentTaskRequest,
  type StartAgentTaskRequest,
} from "./agentTask";
import {
  AGENT_SESSION_BACKGROUND_TASKS_EVENT,
  AGENT_SESSION_BACKGROUND_TURN_EVENT,
  MAX_AGENT_SESSION_REPORTED_BACKGROUND_TASKS,
  AGENT_SESSION_ENDED_EVENT,
  MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES,
  agentSessionEndedNotice,
  isAgentSessionRestartConfirmationError,
  parseAgentSessionBackgroundTasksEvent,
  parseAgentSessionBackgroundTurnEvent,
  parseAgentSessionEndedEvent,
  parseAgentBackgroundTaskStopOutcome,
  parseAgentSessionInspection,
  parseAgentTaskInterruptOutcome,
  parseEndAgentThreadSessionResult,
  validateAgentThreadSessionRequest,
  validateInspectAgentThreadSessionRequest,
  validateInterruptAgentTaskRequest,
  validateStopAgentBackgroundTaskRequest,
} from "./agentThreadSession";

const START: StartAgentTaskRequest = {
  taskId: "agt-1-0a1b",
  threadId: "agt-1-0a1c",
  workspaceId: "ws-1",
  projectRoot: "/repo",
  repositoryRoot: "/repo",
  cwd: "/repo",
  isolation: "in-place",
  prompt: "continue",
  agentCliKind: "claudeCode",
  resumeSessionId: "sess-fixture-0001",
  launch: defaultAgentLaunchOptions("claudeCode"),
  providerGeneration: 1,
  attachments: [],
};

const PINNED_BACKGROUND_TASKS_JSON =
  '{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":1,"agents":1,"tasks":[{"taskId":"a4b355dcf6056a875","taskType":"agent","description":"Live Codex model catalog like Claude"}],"reply":"none"}';

const PINNED_BACKGROUND_REPLY_JSON =
  '{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":0,"agents":0,"tasks":[],"reply":"inProgress"}';

const PINNED_BACKGROUND_TURN_JSON =
  '{"workspaceId":"ws-1","threadId":"agt-1-0a1c","output":"...","truncated":false,"complete":true}';

describe("agent thread session contracts", () => {
  it("keeps the start request unchanged without a restart policy and accepts only known policies", () => {
    expect(validateStartAgentTaskRequest(START)).toEqual(START);
    expect(validateStartAgentTaskRequest({ ...START, sessionRestart: "stopBackground" })).toEqual({
      ...START,
      sessionRestart: "stopBackground",
    });
    expect(
      validateStartAgentTaskRequest({ ...START, sessionRestart: "refuseIfBackground" }),
    ).toEqual({ ...START, sessionRestart: "refuseIfBackground" });
    expect(() => validateStartAgentTaskRequest({ ...START, sessionRestart: "always" })).toThrow(
      TypeError,
    );
    expect(() => validateStartAgentTaskRequest({ ...START, unknown: true })).toThrow(TypeError);
  });

  it("parses the pinned interrupt, inspection and end shapes", () => {
    expect(parseAgentTaskInterruptOutcome({ kind: "interrupting" })).toEqual({
      kind: "interrupting",
    });
    expect(parseAgentTaskInterruptOutcome({ kind: "stopping" })).toEqual({ kind: "stopping" });
    expect(() => parseAgentTaskInterruptOutcome({ kind: "maybe" })).toThrow(TypeError);
    expect(() => parseAgentTaskInterruptOutcome({ kind: "unsupported", extra: 1 })).toThrow(
      TypeError,
    );
    expect(parseAgentSessionInspection({ kind: "restart", backgroundTasks: true })).toEqual({
      kind: "restart",
      backgroundTasks: true,
    });
    expect(parseAgentSessionInspection({ kind: "reuse", backgroundTasks: false })).toEqual({
      kind: "reuse",
      backgroundTasks: false,
    });
    expect(parseAgentSessionInspection({ kind: "none" })).toEqual({ kind: "none" });
    expect(() => parseAgentSessionInspection({ kind: "none", backgroundTasks: true })).toThrow(
      TypeError,
    );
    expect(() => parseAgentSessionInspection({ kind: "other", backgroundTasks: true })).toThrow(
      TypeError,
    );
    expect(parseEndAgentThreadSessionResult({ ended: true })).toBe(true);
    expect(() => parseEndAgentThreadSessionResult({ ended: "yes" })).toThrow(TypeError);
  });

  it("parses the ended event exactly as the backend serializes it", () => {
    const event = {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      reason: "idleTimeout",
      backgroundTasksLive: true,
    };
    expect(AGENT_SESSION_ENDED_EVENT).toBe("agent-session://ended");
    expect(parseAgentSessionEndedEvent(event)).toEqual(event);
    expect(() => parseAgentSessionEndedEvent({ ...event, reason: "other" })).toThrow(TypeError);
    expect(() => parseAgentSessionEndedEvent({ ...event, extra: 1 })).toThrow(TypeError);
  });

  it("parses the pinned background-turn event exactly as the backend serializes it", () => {
    expect(AGENT_SESSION_BACKGROUND_TURN_EVENT).toBe("agent-session://background-turn");
    expect(parseAgentSessionBackgroundTurnEvent(JSON.parse(PINNED_BACKGROUND_TURN_JSON))).toEqual({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      output: "...",
      truncated: false,
      complete: true,
    });
    const lines =
      '{"type":"system","subtype":"init"}\n{"type":"result","subtype":"success","user_message_uuid":null}\n';
    expect(
      parseAgentSessionBackgroundTurnEvent({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        output: lines,
        truncated: true,
        complete: false,
      }),
    ).toEqual({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      output: lines,
      truncated: true,
      complete: false,
    });
    expect(
      parseAgentSessionBackgroundTurnEvent({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        output: "",
        truncated: true,
        complete: false,
      }).output,
    ).toBe("");
  });

  it("rejects background-turn events that are not exactly the pinned shape", () => {
    const event = JSON.parse(PINNED_BACKGROUND_TURN_JSON) as Record<string, unknown>;
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, extra: 1 })).toThrow(TypeError);
    const { complete: _complete, ...missing } = event;
    expect(() => parseAgentSessionBackgroundTurnEvent(missing)).toThrow(TypeError);
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, truncated: "no" })).toThrow(
      TypeError,
    );
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, complete: 1 })).toThrow(
      TypeError,
    );
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, output: null })).toThrow(
      TypeError,
    );
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, threadId: "../escape" })).toThrow(
      TypeError,
    );
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, workspaceId: "" })).toThrow(
      TypeError,
    );
    expect(() => parseAgentSessionBackgroundTurnEvent([event])).toThrow(TypeError);
  });

  it("parses the pinned background-tasks level exactly as the backend serializes it", () => {
    expect(AGENT_SESSION_BACKGROUND_TASKS_EVENT).toBe("agent-session://background-tasks");
    expect(parseAgentSessionBackgroundTasksEvent(JSON.parse(PINNED_BACKGROUND_TASKS_JSON))).toEqual(
      {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        total: 1,
        agents: 1,
        tasks: [
          {
            taskId: "a4b355dcf6056a875",
            taskType: "agent",
            description: "Live Codex model catalog like Claude",
          },
        ],
        reply: "none",
      },
    );
    expect(parseAgentSessionBackgroundTasksEvent(JSON.parse(PINNED_BACKGROUND_REPLY_JSON))).toEqual(
      {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        total: 0,
        agents: 0,
        tasks: [],
        reply: "inProgress",
      },
    );
    expect(
      parseAgentSessionBackgroundTasksEvent({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        total: 0,
        agents: 0,
        tasks: [],
        reply: "none",
      }),
    ).toEqual({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      total: 0,
      agents: 0,
      tasks: [],
      reply: "none",
    });
    expect(
      parseAgentSessionBackgroundTasksEvent({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        total: 40,
        agents: 0,
        reply: "none",
        tasks: Array.from({ length: MAX_AGENT_SESSION_REPORTED_BACKGROUND_TASKS }, (_, index) => ({
          taskId: `b${index}`,
          taskType: "shell",
        })),
      }).tasks,
    ).toHaveLength(MAX_AGENT_SESSION_REPORTED_BACKGROUND_TASKS);
  });

  it("rejects background-tasks levels that are not exactly the pinned, bounded shape", () => {
    const event = JSON.parse(PINNED_BACKGROUND_TASKS_JSON) as Record<string, unknown>;
    const task = { taskId: "a4b355dcf6056a875", taskType: "agent" };
    const { reply: _reply, ...withoutReply } = event;
    const drained = { ...event, total: 0, agents: 0, tasks: [] };
    expect(parseAgentSessionBackgroundTasksEvent(drained).reply).toBe("none");
    for (const broken of [
      { ...event, extra: 1 },
      withoutReply,
      { ...event, reply: "writing" },
      { ...event, reply: "InProgress" },
      { ...event, reply: true },
      { ...event, reply: null },
      { ...drained, extra: 1 },
      { ...drained, reply: "inProgress", replying: true },
      { ...event, total: -1 },
      { ...event, total: 1.5 },
      { ...event, total: 257 },
      { ...event, agents: 2 },
      { ...event, total: 0, agents: 0 },
      { ...event, tasks: [task, task] },
      { ...event, tasks: [{ ...task, taskType: "workflow" }] },
      { ...event, tasks: [{ ...task, extra: true }] },
      { ...event, tasks: [{ ...task, taskId: "" }] },
      { ...event, tasks: [{ ...task, taskId: "a\u0007b" }] },
      { ...event, tasks: [{ ...task, description: "" }] },
      { ...event, tasks: [{ ...task, description: "x".repeat(513) }] },
      { ...event, tasks: [{ ...task, description: "é".repeat(257) }] },
      { ...event, tasks: [{ ...task, description: "bell\u0007" }] },
      { ...event, tasks: null },
      { ...event, threadId: "../escape" },
      {
        ...event,
        total: 40,
        agents: 0,
        tasks: Array.from(
          { length: MAX_AGENT_SESSION_REPORTED_BACKGROUND_TASKS + 1 },
          (_, index) => ({
            taskId: `b${index}`,
            taskType: "shell",
          }),
        ),
      },
    ]) {
      expect(() => parseAgentSessionBackgroundTasksEvent(broken)).toThrow(TypeError);
    }
  });

  it("bounds background-turn output by UTF-8 bytes, not string length", () => {
    const event = JSON.parse(PINNED_BACKGROUND_TURN_JSON) as Record<string, unknown>;
    expect(MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES).toBe(256 * 1024);
    const atLimit = "a".repeat(MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES);
    expect(parseAgentSessionBackgroundTurnEvent({ ...event, output: atLimit }).output).toBe(
      atLimit,
    );
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, output: `${atLimit}a` })).toThrow(
      TypeError,
    );
    const multibyte = "é".repeat(MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES / 2 + 1);
    expect(multibyte.length).toBeLessThan(MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES);
    expect(() => parseAgentSessionBackgroundTurnEvent({ ...event, output: multibyte })).toThrow(
      TypeError,
    );
  });

  it("validates closed session requests", () => {
    expect(
      validateInterruptAgentTaskRequest({
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
      }),
    ).toEqual({ taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" });
    expect(() =>
      validateInterruptAgentTaskRequest({
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        extra: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      validateAgentThreadSessionRequest({ workspaceId: "ws-1", threadId: "../escape" }),
    ).toThrow(TypeError);
    expect(
      validateInspectAgentThreadSessionRequest({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        resumeSessionId: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      }).resumeSessionId,
    ).toBeNull();
    expect(() =>
      validateInspectAgentThreadSessionRequest({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        resumeSessionId: "bad id",
        launch: defaultAgentLaunchOptions("claudeCode"),
      }),
    ).toThrow(TypeError);
  });

  it("recognises only the confirmation-prefixed restart rejection", () => {
    expect(
      isAgentSessionRestartConfirmationError(
        "sessionRestartRequiresConfirmation: Restarting ends this Claude session. Background tasks it started may stop.",
      ),
    ).toBe(true);
    expect(
      isAgentSessionRestartConfirmationError(
        new Error("sessionRestartRequiresConfirmation: confirm first"),
      ),
    ).toBe(true);
    expect(isAgentSessionRestartConfirmationError(new Error("Agent task startup is closed."))).toBe(
      false,
    );
    expect(isAgentSessionRestartConfirmationError({ message: "sessionRestart" })).toBe(false);
    expect(failureMessageOf(42)).toBe("");
  });

  it("tells the user only when something other than their own action ended a session with live background tasks", () => {
    const base = {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      backgroundTasksLive: true,
    } as const;
    expect(agentSessionEndedNotice({ ...base, reason: "idleTimeout" })).toBe(
      "The Claude session was idle too long while background tasks were still running in this thread; Claude can no longer report on them.",
    );
    expect(agentSessionEndedNotice({ ...base, reason: "stopped" })).toBeNull();
    expect(agentSessionEndedNotice({ ...base, reason: "threadEnded" })).toBeNull();
    expect(
      agentSessionEndedNotice({ ...base, reason: "crashed", backgroundTasksLive: false }),
    ).toBeNull();
  });

  it("validates the closed stop-background-task request", () => {
    const request = { workspaceId: "ws-1", threadId: "agt-1-0a1c", taskId: "b8kzpiexm" };
    expect(validateStopAgentBackgroundTaskRequest(request)).toEqual(request);
    expect(validateStopAgentBackgroundTaskRequest({ ...request, taskId: "é".repeat(128) })).toEqual(
      { ...request, taskId: "é".repeat(128) },
    );
    const invalid: ReadonlyArray<unknown> = [
      { ...request, extra: 1 },
      { workspaceId: "ws-1", threadId: "agt-1-0a1c" },
      { ...request, threadId: "../escape" },
      { ...request, workspaceId: "" },
      { ...request, taskId: "" },
      { ...request, taskId: "a".repeat(257) },
      { ...request, taskId: "é".repeat(129) },
      { ...request, taskId: "task\nid" },
      { ...request, taskId: 7 },
      null,
    ];
    for (const value of invalid) {
      expect(() => validateStopAgentBackgroundTaskRequest(value)).toThrow(TypeError);
    }
  });

  it("parses the pinned stop-background-task outcomes exactly as the backend serializes them", () => {
    const pinned: ReadonlyArray<readonly [string, unknown]> = [
      ['{"kind":"stopping"}', { kind: "stopping" }],
      [
        '{"kind":"refused","reason":"No task found with ID: b8kzpiexm"}',
        { kind: "refused", reason: "No task found with ID: b8kzpiexm" },
      ],
      ['{"kind":"unconfirmed"}', { kind: "unconfirmed" }],
      ['{"kind":"notLive"}', { kind: "notLive" }],
      ['{"kind":"noSession"}', { kind: "noSession" }],
      ['{"kind":"unavailable"}', { kind: "unavailable" }],
    ];
    for (const [json, expected] of pinned) {
      expect(parseAgentBackgroundTaskStopOutcome(JSON.parse(json) as unknown)).toEqual(expected);
    }
  });

  it("rejects stop-background-task outcomes that are not exactly the pinned, bounded shape", () => {
    const invalid: ReadonlyArray<unknown> = [
      { kind: "stopped" },
      { kind: "stopping", reason: "extra" },
      { kind: "notLive", extra: true },
      { kind: "refused" },
      { kind: "refused", reason: "" },
      { kind: "refused", reason: "a".repeat(257) },
      { kind: "refused", reason: "é".repeat(129) },
      { kind: "refused", reason: "line\nbreak" },
      { kind: "refused", reason: 3 },
      { kind: "refused", reason: "ok", extra: 1 },
      {},
      "stopping",
      null,
    ];
    for (const value of invalid) {
      expect(() => parseAgentBackgroundTaskStopOutcome(value)).toThrow(TypeError);
    }
    expect(
      parseAgentBackgroundTaskStopOutcome({ kind: "refused", reason: "é".repeat(128) }),
    ).toEqual({ kind: "refused", reason: "é".repeat(128) });
  });
});
