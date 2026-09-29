import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../domain/agentThread";
import { catalogThread } from "../test/agentHistoryCatalogFixtures";
import type { DeferredFollowUp, DeferredFollowUps } from "./agentDeferredFollowUps";
import type { AgentFollowUpRequest } from "./agentThreadPorts";
import {
  DEFERRED_SESSION_RESTART_NOTICE,
  DeferredRestartRefusals,
  FOLLOW_UP_SESSION_RESTART_NOTICE,
  FollowUpRestartRefusals,
} from "./agentSessionRestartConsent";

const LAUNCH: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "default",
  mode: "supervised",
  effort: "high",
};

function turn(turnId: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId,
    prompt: "prompt",
    status,
    startedAtEpochMs: 1,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
  };
}

function thread(
  turns: ReadonlyArray<AgentTurn>,
  overrides: Partial<AgentThread> = {},
): AgentThread {
  return { ...catalogThread("agt-1-0a1b"), turns, ...overrides };
}

function request(prompt: string): AgentFollowUpRequest {
  return { threadId: "agt-1-0a1b", prompt, launch: LAUNCH };
}

function queue(...ids: string[]): DeferredFollowUps {
  const entries: DeferredFollowUp[] = ids.map((id) => ({
    id,
    request: request(id),
    queuedAtEpochMs: 1,
    state: "paused",
  }));
  return new Map([["agt-1-0a1b", entries]]);
}

describe("FollowUpRestartRefusals", () => {
  it("hands out a held follow-up once and only while the refused turn is still the last one", () => {
    const refusals = new FollowUpRestartRefusals();
    const refused = thread([turn("t-1", { kind: "stopped" })]);
    refusals.refuse(refused.threadId, "t-1");
    const notice = refusals.offer(refused, request("retry"));
    const action = notice?.action;
    const id = typeof action === "object" && action !== null ? action.entryId : "";

    expect(refusals.take(refused, "restart-other")).toBeNull();
    expect(refusals.take(refused, id)?.prompt).toBe("retry");
    expect(refusals.take(refused, id)).toBeNull();
    expect(refusals.refused(refused.threadId)).toBe(false);
  });

  it("drops a held follow-up after a newer turn or an owner change", () => {
    const refusals = new FollowUpRestartRefusals();
    const refused = thread([turn("t-1", { kind: "stopped" })]);
    refusals.refuse(refused.threadId, "t-1");
    const first = refusals.offer(refused, request("retry"))?.action;
    const firstId = typeof first === "object" && first !== null ? first.entryId : "";
    const newer = thread([turn("t-1", { kind: "stopped" }), turn("t-2", { kind: "running" })]);
    expect(refusals.take(newer, firstId)).toBeNull();

    refusals.refuse(refused.threadId, "t-1");
    const second = refusals.offer(refused, request("retry"))?.action;
    const secondId = typeof second === "object" && second !== null ? second.entryId : "";
    const rebound = thread([turn("t-1", { kind: "stopped" })], {
      owner: { ...refused.owner, ownerId: "agent-root:other" },
    });
    expect(refusals.take(rebound, secondId)).toBeNull();
  });

  it("offers no restart action for a follow-up with attachments", () => {
    const refusals = new FollowUpRestartRefusals();
    const refused = thread([turn("t-1", { kind: "stopped" })]);
    refusals.refuse(refused.threadId, "t-1");
    const withAttachment: AgentFollowUpRequest = {
      ...request("with image"),
      attachments: [
        {
          kind: "staged",
          attachmentId: "0123456789abcdef0123456789abcdef",
          name: "shot.png",
          bytes: 2_048,
          mime: "image/png",
          width: 800,
          height: 600,
        },
      ],
    };

    expect(refusals.offer(refused, withAttachment)?.action).toBeNull();
  });

  it("holds a follow-up refused before its turn started while no newer turn appeared", () => {
    const refusals = new FollowUpRestartRefusals();
    const settled = thread([turn("t-1", { kind: "exited", exitCode: 0 })]);
    refusals.refuseBeforeStart(settled);
    expect(refusals.refused(settled.threadId)).toBe(true);
    const action = refusals.offer(settled, request("compact"))?.action;
    const id = typeof action === "object" && action !== null ? action.entryId : "";

    expect(refusals.take(settled, id)?.prompt).toBe("compact");
    expect(refusals.take(settled, id)).toBeNull();

    refusals.refuseBeforeStart(settled);
    const second = refusals.offer(settled, request("compact"))?.action;
    const secondId = typeof second === "object" && second !== null ? second.entryId : "";
    const newer = thread([
      turn("t-1", { kind: "exited", exitCode: 0 }),
      turn("t-2", { kind: "exited", exitCode: 0 }),
    ]);
    expect(refusals.offer(newer, request("compact"))).toBeNull();
    expect(refusals.take(newer, secondId)).toBeNull();
  });

  it("explains every restart with the same consequence", () => {
    expect(FOLLOW_UP_SESSION_RESTART_NOTICE).toBe(
      "Claude was not restarted because it is running background tasks in this thread. Restarting ends this Claude session. Background tasks it started may stop.",
    );
    expect(DEFERRED_SESSION_RESTART_NOTICE).toBe(
      "Queued messages are paused because sending the next one restarts Claude for this thread. Restarting ends this Claude session. Background tasks it started may stop.",
    );
  });

  it("keeps at most 256 refused threads and evicts the oldest", () => {
    const refusals = new FollowUpRestartRefusals();
    for (let index = 0; index <= 256; index += 1) refusals.refuse(`agt-${index}`, "t-1");

    expect(refusals.refused("agt-0")).toBe(false);
    expect(refusals.refused("agt-1")).toBe(true);
    expect(refusals.refused("agt-256")).toBe(true);
  });
});

describe("DeferredRestartRefusals", () => {
  it("claims only the refused queue head of a settled thread, once", () => {
    const refusals = new DeferredRestartRefusals();
    const settled = thread([turn("t-1", { kind: "exited", exitCode: 0 })]);
    const running = thread([turn("t-1", { kind: "running" })]);
    refusals.refuse(settled.threadId, "deferred-1");

    expect(refusals.claim(queue("deferred-1"), running, "deferred-1")).toBe(false);
    expect(refusals.claim(queue("deferred-2", "deferred-1"), settled, "deferred-1")).toBe(false);
    expect(refusals.claim(queue("deferred-1"), settled, "deferred-1")).toBe(true);
    expect(refusals.claim(queue("deferred-1"), settled, "deferred-1")).toBe(false);
  });

  it("re-announces a refusal only while its entry is still queued", () => {
    const refusals = new DeferredRestartRefusals();
    const notices: unknown[] = [];
    const ports = { setNotice: (notice: unknown) => notices.push(notice) };
    refusals.refuse("agt-1-0a1b", "deferred-1");

    expect(refusals.renotify(queue("deferred-1"), "agt-1-0a1b", ports)).toBe(true);
    expect(refusals.renotify(queue("deferred-2"), "agt-1-0a1b", ports)).toBe(false);
    expect(refusals.renotify(queue("deferred-1"), "agt-1-0a1b", ports)).toBe(false);
    expect(notices).toHaveLength(1);
  });
});
