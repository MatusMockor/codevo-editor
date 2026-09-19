// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  CLIPPED_AGENT_PROMPT_MARKER,
  clipAgentPromptForPersistence,
} from "../domain/agentPromptClipping";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import type { AgentTurnLogSummary } from "../domain/agentTurnLog";
import {
  LOG_THREAD_ID,
  logThread,
  logTurn,
  renderLogStore,
  sealedLogSummary,
  settleLogStore,
  type LogStoreOptions,
} from "../test/agentTurnLogStoreHarness";

const OLD_TURN_ID = "agt-1-0a1c";
const NEW_TURN_ID = "agt-1-0a1d";

const FULL_OLD_PROMPT = `Rewrite the tokenizer ${"and keep every escape sequence working ".repeat(40)}`;

function clipped(prompt: string): string {
  const projection = clipAgentPromptForPersistence(prompt);
  expect(projection).not.toBeNull();
  return projection ?? prompt;
}

function settledTurn(
  turnId: string,
  prompt: string,
  overrides: Partial<AgentTurn> = {},
): AgentTurn {
  return logTurn({ turnId, prompt, ...overrides });
}

function threadWith(turns: ReadonlyArray<AgentTurn>): AgentThread {
  return logThread({ turns });
}

function promptSummary(turnId: string, prompt: string | null): AgentTurnLogSummary {
  return sealedLogSummary(turnId, 4, { prompt });
}

function renderRestorable(options: LogStoreOptions) {
  return renderLogStore(options);
}

function promptSummarizeCount(harness: ReturnType<typeof renderLogStore>): number {
  return harness.logGateway.summarized.filter((request) => request.includePrompts).length;
}

describe("restoring a clipped turn prompt from the turn log", () => {
  it("gives the full prompt back on thread open without saving the thread", async () => {
    const harness = renderRestorable({
      persisted: [
        threadWith([
          settledTurn(OLD_TURN_ID, clipped(FULL_OLD_PROMPT)),
          settledTurn(NEW_TURN_ID, "ship it"),
        ]),
      ],
      summaries: [
        promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT),
        promptSummary(NEW_TURN_ID, "ship it"),
      ],
    });
    await settleLogStore();
    const savesBefore = harness.saved.length;

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const restored = harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID);
    expect(restored?.prompt).toBe(FULL_OLD_PROMPT);
    expect(restored?.promptRestored).toBe(true);
    expect(harness.turnOf(LOG_THREAD_ID, NEW_TURN_ID)?.prompt).toBe("ship it");
    expect(promptSummarizeCount(harness)).toBe(1);
    expect(harness.saved).toHaveLength(savesBefore);
    await harness.unmount();
  });

  it("asks for prompts only once per open and never again once the thread is reconciled", async () => {
    const harness = renderRestorable({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, clipped(FULL_OLD_PROMPT))])],
      summaries: [promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT)],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(promptSummarizeCount(harness)).toBe(1);
    await harness.unmount();
  });

  it("issues no prompt request at all when no saved prompt looks clipped", async () => {
    const harness = renderRestorable({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, "short and whole")])],
      summaries: [promptSummary(OLD_TURN_ID, "short and whole")],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(promptSummarizeCount(harness)).toBe(0);
    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.promptRestored).toBeUndefined();
    await harness.unmount();
  });

  it("never touches a running turn while it restores the settled ones", async () => {
    const runningPrompt = clipped(FULL_OLD_PROMPT);
    const harness = renderRestorable({
      summaries: [
        promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT),
        sealedLogSummary(NEW_TURN_ID, 4, { prompt: FULL_OLD_PROMPT, sealed: false }),
      ],
    });
    await settleLogStore();
    act(() => {
      harness.hook().dispatchAction({
        kind: "threadCreated",
        thread: threadWith([settledTurn(OLD_TURN_ID, clipped(FULL_OLD_PROMPT))]),
      });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: LOG_THREAD_ID,
        turn: settledTurn(NEW_TURN_ID, runningPrompt, {
          status: { kind: "running" },
          endedAtEpochMs: null,
        }),
      });
    });
    await settleLogStore();
    const savesBefore = harness.saved.length;

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.prompt).toBe(FULL_OLD_PROMPT);
    const running = harness.turnOf(LOG_THREAD_ID, NEW_TURN_ID);
    expect(running?.status).toEqual({ kind: "running" });
    expect(running?.prompt).toBe(runningPrompt);
    expect(running?.promptRestored).toBeUndefined();
    expect(harness.saved).toHaveLength(savesBefore);
    await harness.unmount();
  });

  it("drops a prompt response that settles after the workspace was replaced", async () => {
    const savedPrompt = clipped(FULL_OLD_PROMPT);
    const harness = renderRestorable({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, savedPrompt)])],
      summaries: [promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT)],
    });
    await settleLogStore();
    act(() =>
      harness.turnLog.facts.publishSummaries(LOG_THREAD_ID, [
        promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT),
      ]),
    );

    harness.logGateway.holdSummaries = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(promptSummarizeCount(harness)).toBe(1);

    harness.setProjects([]);
    await settleLogStore();
    harness.logGateway.holdSummaries = false;
    harness.logGateway.releaseSummaries();
    await settleLogStore();

    const kept = harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID);
    expect(kept?.prompt).toBe(savedPrompt);
    expect(kept?.promptRestored).toBeUndefined();
    await harness.unmount();
  });

  it("keeps a prompt that legitimately ends with the marker and clears its guard", async () => {
    const honest = `please keep this ending ${CLIPPED_AGENT_PROMPT_MARKER}`;
    const harness = renderRestorable({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, honest)])],
      summaries: [promptSummary(OLD_TURN_ID, honest)],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const reconciled = harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID);
    expect(reconciled?.prompt).toBe(honest);
    expect(reconciled?.promptRestored).toBe(true);
    await harness.unmount();
  });

  it("publishes nothing when the logged prompt does not extend the saved one", async () => {
    const savedPrompt = clipped(FULL_OLD_PROMPT);
    const harness = renderRestorable({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, savedPrompt)])],
      summaries: [promptSummary(OLD_TURN_ID, "a completely unrelated prompt body")],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const kept = harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID);
    expect(kept?.prompt).toBe(savedPrompt);
    expect(kept?.promptRestored).toBeUndefined();
    await harness.unmount();
  });
});

describe("prompt evidence on the write paths", () => {
  it("sends the turn's full prompt when it opens a turn log", async () => {
    const harness = renderRestorable({});
    await settleLogStore();

    act(() => {
      harness.hook().dispatchAction({ kind: "threadCreated", thread: logThread() });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: LOG_THREAD_ID,
        turn: logTurn({
          prompt: FULL_OLD_PROMPT,
          status: { kind: "running" },
          endedAtEpochMs: null,
        }),
      });
    });
    await settleLogStore();

    expect(harness.logGateway.opens.map((request) => request.prompt)).toEqual([FULL_OLD_PROMPT]);
    await harness.unmount();
  });

  it("never seeds the log with a prompt the saved thread already clipped", async () => {
    const harness = renderRestorable({});
    await settleLogStore();

    act(() => {
      harness.hook().dispatchAction({ kind: "threadCreated", thread: logThread() });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: LOG_THREAD_ID,
        turn: logTurn({
          prompt: clipped(FULL_OLD_PROMPT),
          status: { kind: "running" },
          endedAtEpochMs: null,
        }),
      });
    });
    await settleLogStore();

    expect(harness.logGateway.opens.map((request) => request.prompt)).toEqual([null]);
    await harness.unmount();
  });

  it("carries the turns whose log holds the prompt into the save request", async () => {
    const harness = renderRestorable({
      persisted: [
        threadWith([
          settledTurn(OLD_TURN_ID, FULL_OLD_PROMPT),
          settledTurn(NEW_TURN_ID, "ship it"),
        ]),
      ],
      summaries: [promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT), promptSummary(NEW_TURN_ID, null)],
    });
    await settleLogStore();
    act(() =>
      harness.turnLog.facts.publishSummaries(LOG_THREAD_ID, [
        promptSummary(OLD_TURN_ID, FULL_OLD_PROMPT),
        promptSummary(NEW_TURN_ID, null),
      ]),
    );

    act(() => harness.hook().rename(LOG_THREAD_ID, "Tokenizer work"));
    await settleLogStore();

    const last = harness.saved[harness.saved.length - 1];
    expect(last?.loggedPromptTurnIds).toEqual([OLD_TURN_ID]);
    await harness.unmount();
  });

  it("carries no prompt evidence for a thread that is not logged", async () => {
    const imported = logThread({
      externalOrigin: {
        provider: "claudeCode",
        sessionId: "session-imported-1",
        importedAtEpochMs: 10,
      },
    });
    const harness = renderRestorable({ persisted: [imported] });
    await settleLogStore();

    act(() => harness.hook().rename(LOG_THREAD_ID, "Imported"));
    await settleLogStore();

    const last = harness.saved[harness.saved.length - 1];
    expect(last?.loggedPromptTurnIds).toEqual([]);
    await harness.unmount();
  });
});
