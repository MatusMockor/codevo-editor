import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "./agentLaunch";
import type { AgentThread, AgentTurn } from "./agentThread";
import {
  RETRY_ARCHIVED_REASON,
  RETRY_ATTACHMENTS_REASON,
  RETRY_CLIPPED_REASON,
  RETRY_NO_LAUNCH_REASON,
  agentFailedLastTurn,
  agentTurnRetryPlan,
} from "./agentTurnRetry";
import { CLIPPED_AGENT_PROMPT_MARKER } from "./agentPromptClipping";

const claude = {
  provider: "claudeCode",
  model: "default",
  mode: "default",
} as unknown as AgentLaunchOptions;
const codex = {
  provider: "codex",
  model: "default",
  mode: "default",
} as unknown as AgentLaunchOptions;

function thread(last: Partial<AgentTurn>, patch: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1",
    archived: false,
    provider: { kind: "claudeCode", sessionId: "s" },
    owner: { rootKey: "/orders", ownerId: "w", repositoryRoot: "/orders" },
    turns: [
      {
        turnId: "t1",
        prompt: "Add idempotency",
        status: { kind: "failed", message: "boom" },
        launch: claude,
        ...last,
      },
    ],
    ...patch,
  } as unknown as AgentThread;
}

describe("agentTurnRetryPlan", () => {
  it("retries a failed or non-zero exit last turn with its own launch", () => {
    expect(agentTurnRetryPlan(thread({}), null)).toEqual({
      kind: "ready",
      threadId: "agt-1",
      failedTurnId: "t1",
      prompt: "Add idempotency",
      launch: claude,
      source: "stored",
      dangerous: true,
    });
    expect(
      agentTurnRetryPlan(thread({ status: { kind: "exited", exitCode: 1 } }), null)?.kind,
    ).toBe("ready");
  });

  it("offers nothing for success, stop, interruption, running or no turns", () => {
    expect(
      agentTurnRetryPlan(thread({ status: { kind: "exited", exitCode: 0 } }), null),
    ).toBeNull();
    expect(agentTurnRetryPlan(thread({ status: { kind: "stopped" } }), null)).toBeNull();
    expect(agentTurnRetryPlan(thread({ status: { kind: "interrupted" } }), null)).toBeNull();
    expect(agentTurnRetryPlan(thread({ status: { kind: "interrupted" } }), null)).toBeNull();
    expect(agentTurnRetryPlan(thread({ status: { kind: "running" } }), null)).toBeNull();
    expect(agentTurnRetryPlan({ ...thread({}), turns: [] } as AgentThread, null)).toBeNull();
  });

  it("only considers the thread's last turn", () => {
    const failedThenOk = thread({});
    const withNewer = {
      ...failedThenOk,
      turns: [
        ...failedThenOk.turns,
        { ...failedThenOk.turns[0]!, turnId: "t2", status: { kind: "exited", exitCode: 0 } },
      ],
    } as AgentThread;
    expect(agentFailedLastTurn(withNewer)).toBeNull();
    expect(agentTurnRetryPlan(withNewer, null)).toBeNull();
  });

  it("falls back to the last used launch only for the same provider", () => {
    expect(agentTurnRetryPlan(thread({ launch: null }), claude)).toMatchObject({
      kind: "ready",
      launch: claude,
      source: "lastUsed",
    });
    expect(agentTurnRetryPlan(thread({ launch: null }), codex)).toEqual({
      kind: "unavailable",
      failedTurnId: "t1",
      reason: RETRY_NO_LAUNCH_REASON,
    });
  });

  it("marks launches that run without permission prompts as dangerous", () => {
    const plan = (launch: AgentLaunchOptions) => agentTurnRetryPlan(thread({ launch }), null);
    expect(plan({ ...claude, mode: "bypassPermissions" } as AgentLaunchOptions)).toMatchObject({
      dangerous: true,
    });
    expect(plan({ ...claude, mode: "acceptEdits" } as AgentLaunchOptions)).toMatchObject({
      dangerous: false,
    });
    const codexThread = thread(
      { launch: { ...codex, mode: "dangerFullAccess" } as AgentLaunchOptions },
      { provider: { kind: "codex", sessionId: "s" } } as Partial<AgentThread>,
    );
    expect(agentTurnRetryPlan(codexThread, null)).toMatchObject({ dangerous: true });
    const guarded = thread({ launch: { ...codex, mode: "workspaceWrite" } as AgentLaunchOptions }, {
      provider: { kind: "codex", sessionId: "s" },
    } as Partial<AgentThread>);
    expect(agentTurnRetryPlan(guarded, null)).toMatchObject({ dangerous: false });
  });

  it("refuses clipped prompts, attachments and archived threads with a reason", () => {
    expect(
      agentTurnRetryPlan(thread({ prompt: `long${CLIPPED_AGENT_PROMPT_MARKER}` }), null),
    ).toMatchObject({ reason: RETRY_CLIPPED_REASON });
    expect(
      agentTurnRetryPlan(
        thread({ attachments: [{ kind: "reference", name: "a.ts", path: "/a.ts", bytes: 1 }] }),
        null,
      ),
    ).toMatchObject({ reason: RETRY_ATTACHMENTS_REASON });
    expect(agentTurnRetryPlan(thread({}, { archived: true }), null)).toMatchObject({
      reason: RETRY_ARCHIVED_REASON,
    });
  });
});
