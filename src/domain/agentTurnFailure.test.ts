import { describe, expect, it } from "vitest";
import type { AgentCliKind } from "./agentTask";
import type { AgentThread, AgentTurn, AgentTurnEvent, AgentTurnStatus } from "./agentThread";
import {
  agentThreadRequiresNewThread,
  agentTurnFailureError,
  agentTurnReportedFailure,
} from "./agentTurnFailure";

const REMOVED_NOTICE =
  "API Error: an image in the conversation could not be processed and was removed. Re-read the file with a different approach if you still need it.";
const EXITED: AgentTurnStatus = { kind: "exited", exitCode: 1 };

function turn(status: AgentTurnStatus, events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return { turnId: "t1", prompt: "p", status, events } as unknown as AgentTurn;
}

function thread(last: AgentTurn, provider: AgentCliKind = "claudeCode"): AgentThread {
  return {
    threadId: "agt-1",
    archived: false,
    provider: { kind: provider, sessionId: "s" },
    owner: { rootKey: "/r", ownerId: "w", repositoryRoot: "/r" },
    turns: [last],
  } as unknown as AgentThread;
}

function result(text: string, isError = true): AgentTurnEvent {
  return { kind: "result", text, isError, usage: null };
}

describe("agentTurnReportedFailure", () => {
  it("reads the image notice from the result of a failed run", () => {
    const events = [
      { kind: "assistantText", text: REMOVED_NOTICE },
      result(REMOVED_NOTICE),
    ] as const;

    expect(agentTurnReportedFailure(turn(EXITED, events), "claudeCode")?.detail.kind).toBe(
      "conversationImagesTooLarge",
    );
  });

  it("reads the image notice when the assistant text was the only output", () => {
    const events = [{ kind: "assistantText", text: REMOVED_NOTICE }] as const;

    expect(agentTurnReportedFailure(turn(EXITED, events), "claudeCode")?.signature).toBe(
      "conversationImagesTooLarge:claudeCode",
    );
  });

  it("reads the image notice behind an error result without text", () => {
    const events = [
      { kind: "assistantText", text: REMOVED_NOTICE },
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1 },
      result(""),
    ] as unknown as ReadonlyArray<AgentTurnEvent>;

    expect(agentTurnReportedFailure(turn(EXITED, events), "claudeCode")?.detail.kind).toBe(
      "conversationImagesTooLarge",
    );
  });

  it("does not blame the image notice when the turn kept working after it", () => {
    const continued: ReadonlyArray<ReadonlyArray<AgentTurnEvent>> = [
      [
        { kind: "assistantText", text: REMOVED_NOTICE },
        { kind: "reasoning", text: "Retry smaller." },
      ],
      [
        { kind: "assistantText", text: REMOVED_NOTICE },
        { kind: "reasoning", text: "Retry smaller." },
        result(""),
      ],
      [
        { kind: "assistantText", text: REMOVED_NOTICE },
        { kind: "userMessage", text: "steer" } as unknown as AgentTurnEvent,
        result(""),
      ],
      [
        { kind: "assistantText", text: REMOVED_NOTICE },
        { kind: "toolResult", toolId: "t", outputSummary: "ok", isError: false },
      ],
    ];

    for (const events of continued) {
      expect(agentTurnReportedFailure(turn(EXITED, events), "claudeCode")).toBeNull();
    }
  });

  it("does not attach the image notice to a different reported error", () => {
    const events = [
      { kind: "assistantText", text: REMOVED_NOTICE },
      result("API Error: Connection error."),
    ] as const;

    expect(
      agentTurnReportedFailure(turn(EXITED, events), "claudeCode")?.detail.kind ?? null,
    ).not.toBe("conversationImagesTooLarge");
  });

  it("does not treat prose that only quotes the notice as a failure", () => {
    const quoted = `The CLI printed: ${REMOVED_NOTICE.slice("API Error: ".length)}`;
    const subagent = { kind: "assistantText", text: REMOVED_NOTICE, parentToolId: "tool-1" };
    const unprefixed = {
      kind: "assistantText",
      text: REMOVED_NOTICE.slice("API Error: ".length),
    };

    for (const event of [{ kind: "assistantText", text: quoted }, subagent, unprefixed]) {
      expect(
        agentTurnReportedFailure(turn(EXITED, [event as AgentTurnEvent]), "claudeCode"),
      ).toBeNull();
    }
  });

  it("does not read other API errors from assistant text", () => {
    const events = [{ kind: "assistantText", text: "API Error: Repeated 529 Overloaded errors" }];

    expect(
      agentTurnReportedFailure(turn(EXITED, events as ReadonlyArray<AgentTurnEvent>), "claudeCode"),
    ).toBeNull();
  });

  it("does not look past a tool call or a successful result", () => {
    const afterTool = [
      { kind: "assistantText", text: REMOVED_NOTICE },
      { kind: "toolCall", toolId: "t", name: "Bash", inputSummary: "ls" },
      result(""),
    ] as ReadonlyArray<AgentTurnEvent>;
    const succeeded = [
      { kind: "assistantText", text: REMOVED_NOTICE },
      result("done", false),
    ] as ReadonlyArray<AgentTurnEvent>;

    expect(agentTurnReportedFailure(turn(EXITED, afterTool), "claudeCode")).toBeNull();
    expect(agentTurnReportedFailure(turn(EXITED, succeeded), "claudeCode")).toBeNull();
  });

  it("never reads the Claude image notice in a Codex thread", () => {
    const events = [{ kind: "assistantText", text: REMOVED_NOTICE }, result(REMOVED_NOTICE)];

    expect(
      agentTurnReportedFailure(turn(EXITED, events as ReadonlyArray<AgentTurnEvent>), "codex"),
    ).toBeNull();
  });
});

describe("agentTurnFailureError", () => {
  it("classifies the failure message of a failed turn", () => {
    const failed = turn({ kind: "failed", message: REMOVED_NOTICE }, []);

    expect(agentTurnFailureError(failed, "claudeCode")?.detail.kind).toBe(
      "conversationImagesTooLarge",
    );
  });

  it("reads the output when the provider only reported that it failed", () => {
    const failed = turn({ kind: "failed", message: "provider_reported_failure" }, [
      result(REMOVED_NOTICE),
    ]);

    expect(agentTurnFailureError(failed, "claudeCode")?.detail.kind).toBe(
      "conversationImagesTooLarge",
    );
  });

  it("keeps an unknown failure message when the output explains nothing", () => {
    const failed = turn({ kind: "failed", message: "boom" }, [result(REMOVED_NOTICE)]);

    expect(agentTurnFailureError(failed, "claudeCode")?.detail).toEqual({ kind: "unknown" });
  });

  it("reports nothing for a clean exit or a turn that did not fail", () => {
    const events = [result(REMOVED_NOTICE)];

    expect(
      agentTurnFailureError(turn({ kind: "exited", exitCode: 0 }, events), "claudeCode"),
    ).toBeNull();
    expect(agentTurnFailureError(turn({ kind: "stopped" }, events), "claudeCode")).toBeNull();
  });
});

describe("agentThreadRequiresNewThread", () => {
  it("is required only while the last turn failed on oversized conversation images", () => {
    const failed = turn(EXITED, [result(REMOVED_NOTICE)]);
    const overloaded = turn(EXITED, [result("API Error: Repeated 529 Overloaded errors")]);
    const running = turn({ kind: "running" } as AgentTurnStatus, [result(REMOVED_NOTICE)]);

    expect(agentThreadRequiresNewThread(thread(failed))).toBe(true);
    expect(agentThreadRequiresNewThread(thread(overloaded))).toBe(false);
    expect(agentThreadRequiresNewThread(thread(running))).toBe(false);
    expect(agentThreadRequiresNewThread(thread(failed, "codex"))).toBe(false);
  });
});
