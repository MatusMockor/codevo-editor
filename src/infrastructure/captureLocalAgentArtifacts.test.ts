import { describe, expect, it, vi } from "vitest";
import contract from "../../contracts/agent-artifact-errors.json";
import type { AgentArtifactLoader } from "../application/agentArtifactPorts";
import type { AgentArtifactMetadata } from "../domain/agentArtifact";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import {
  AgentArtifactCaptureLedger,
  AGENT_ARTIFACT_CAPTURE_ATTEMPTS,
  AGENT_ARTIFACT_CAPTURE_LEDGER_LIMIT,
  AGENT_ARTIFACT_CAPTURE_RULE,
  captureLocalAgentArtifacts,
} from "./captureLocalAgentArtifacts";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);

const METADATA: AgentArtifactMetadata = {
  id: "a".repeat(64),
  taskId: "agt-2-0a1b",
  name: "design.html",
  mediaType: "text/html",
  sizeBytes: 20,
  sha256: "b".repeat(64),
};

const THREAD: AgentThread = {
  threadId: "agt-1-0a1b",
  owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: ROOT_KEY },
  target: { isolation: "in-place", worktreePath: null },
  provider: { kind: "codex", sessionId: null },
  title: "Fix the parser",
  pinned: true,
  archived: false,
  createdAtEpochMs: 1_000,
  updatedAtEpochMs: 2_000,
  turns: [],
  turnsTruncated: false,
  viewedAtEpochMs: null,
  externalOrigin: null,
  integration: null,
};

function turn(turnId: string, markdown: string, running = false): AgentTurn {
  return {
    turnId,
    prompt: "design",
    status: running ? { kind: "running" } : { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: running ? null : 2_000,
    events: [{ kind: "assistantText", text: markdown }],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
}

function thread(turns: readonly AgentTurn[]): AgentThread {
  return { ...THREAD, turns };
}

function loaderOf(resolve: AgentArtifactLoader["resolve"]): AgentArtifactLoader {
  return { resolve, read: vi.fn() };
}

function captured(): AgentArtifactLoader {
  return loaderOf(vi.fn().mockResolvedValue(METADATA));
}

function run(
  loader: AgentArtifactLoader,
  value: AgentThread,
  ledger: AgentArtifactCaptureLedger,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  return captureLocalAgentArtifacts({ loader, thread: value, ledger, isCurrent });
}

describe("captureLocalAgentArtifacts", () => {
  it("mirrors the shared contract's newest-terminal-turn rule", async () => {
    expect(AGENT_ARTIFACT_CAPTURE_RULE).toBe(contract.newestTerminalTurnRule);
    const loader = captured();
    await run(
      loader,
      thread([
        turn("agt-2-0a1b", "[Old](old.html)"),
        turn("agt-3-0a1b", "[New](new.html)"),
        turn("agt-4-0a1b", "[Running](later.html)", true),
      ]),
      new AgentArtifactCaptureLedger(),
    );

    expect(loader.resolve).toHaveBeenCalledTimes(1);
    expect(loader.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "agt-3-0a1b" }),
      "new.html",
    );
  });

  it("captures nothing while no turn has finished", async () => {
    const loader = captured();
    await run(
      loader,
      thread([turn("agt-2-0a1b", "[Running](later.html)", true)]),
      new AgentArtifactCaptureLedger(),
    );

    expect(loader.resolve).not.toHaveBeenCalled();
  });

  it("resolves each reference at most once per session", async () => {
    const loader = captured();
    const ledger = new AgentArtifactCaptureLedger();
    const value = thread([turn("agt-2-0a1b", "[Preview](design.html)")]);

    await run(loader, value, ledger);
    await run(loader, value, ledger);
    await run(
      loader,
      thread([...value.turns, turn("agt-3-0a1b", "[Running](x.html)", true)]),
      ledger,
    );

    expect(loader.resolve).toHaveBeenCalledTimes(1);
  });

  it("never retries a permanent refusal", async () => {
    const loader = loaderOf(
      vi
        .fn()
        .mockRejectedValue(new Error("The conversation advanced before its artifact was saved.")),
    );
    const ledger = new AgentArtifactCaptureLedger();
    const value = thread([turn("agt-2-0a1b", "[Preview](design.html)")]);

    await run(loader, value, ledger);
    await run(loader, value, ledger);
    await run(loader, value, ledger);

    expect(loader.resolve).toHaveBeenCalledTimes(1);
  });

  it("retries a busy store at most three times", async () => {
    const loader = loaderOf(
      vi.fn().mockRejectedValue(new Error("Artifact storage is busy. Try again.")),
    );
    const ledger = new AgentArtifactCaptureLedger();
    const value = thread([turn("agt-2-0a1b", "[Preview](design.html)")]);

    for (let attempt = 0; attempt < 6; attempt += 1) await run(loader, value, ledger);

    expect(loader.resolve).toHaveBeenCalledTimes(AGENT_ARTIFACT_CAPTURE_ATTEMPTS);
  });

  it("retries a transient read failure on the next save", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("Artifact store is unavailable."))
      .mockResolvedValue(METADATA);
    const ledger = new AgentArtifactCaptureLedger();
    const value = thread([turn("agt-2-0a1b", "[Preview](design.html)")]);

    await run(loaderOf(resolve), value, ledger);
    await run(loaderOf(resolve), value, ledger);
    await run(loaderOf(resolve), value, ledger);

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("drops the work when the owner changed before the reference is resolved", async () => {
    const loader = captured();
    const ledger = new AgentArtifactCaptureLedger();

    await run(loader, thread([turn("agt-2-0a1b", "[Preview](design.html)")]), ledger, () => false);

    expect(loader.resolve).not.toHaveBeenCalled();
  });

  it("drops a result that settled after the owner changed", async () => {
    let settle!: (value: AgentArtifactMetadata) => void;
    const loader = loaderOf(
      vi.fn(
        () =>
          new Promise<AgentArtifactMetadata>((resolve) => {
            settle = resolve;
          }),
      ),
    );
    const ledger = new AgentArtifactCaptureLedger();
    const value = thread([turn("agt-2-0a1b", "[Preview](design.html)")]);
    let current = true;
    const pending = run(loader, value, ledger, () => current);
    current = false;
    settle(METADATA);
    await pending;

    const next = captured();
    await run(next, value, ledger);

    expect(next.resolve).toHaveBeenCalledTimes(1);
  });

  it("invalidates the previous lease of a thread when a newer save claims it", () => {
    const ledger = new AgentArtifactCaptureLedger();
    const first = ledger.claim(THREAD.threadId);
    expect(first()).toBe(true);
    const second = ledger.claim(THREAD.threadId);
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    expect(ledger.claim("agt-9-0a1b")()).toBe(true);
    expect(second()).toBe(true);
  });

  it("keeps a repeatedly claimed lease valid once the ledger is full", () => {
    const ledger = new AgentArtifactCaptureLedger();
    ledger.claim(THREAD.threadId);
    for (let index = 0; index < 8; index += 1) ledger.claim(`agt-${index + 10}-0a1b`);
    const isCurrent = ledger.claim(THREAD.threadId);

    for (let index = 0; index < AGENT_ARTIFACT_CAPTURE_LEDGER_LIMIT - 1; index += 1) {
      ledger.claim(`agt-${index + 100}-0a1b`);
    }

    expect(isCurrent()).toBe(true);
  });

  it("never evicts the lease of a capture that is still in flight", async () => {
    let settle!: (value: AgentArtifactMetadata) => void;
    const loader = loaderOf(
      vi.fn(
        () =>
          new Promise<AgentArtifactMetadata>((resolve) => {
            settle = resolve;
          }),
      ),
    );
    const ledger = new AgentArtifactCaptureLedger();
    const isCurrent = ledger.claim(THREAD.threadId);
    const pending = captureLocalAgentArtifacts({
      loader,
      thread: thread([turn("agt-2-0a1b", "[Preview](design.html)")]),
      ledger,
      isCurrent,
    });

    for (let index = 0; index <= AGENT_ARTIFACT_CAPTURE_LEDGER_LIMIT; index += 1) {
      ledger.claim(`agt-${index + 10}-0a1b`);
    }

    expect(isCurrent()).toBe(true);
    settle(METADATA);
    await pending;
  });

  it("bounds one capture to the shared reference limit", async () => {
    const loader = captured();
    const markdown = Array.from({ length: 40 }, (_, index) => `[P](file-${index}.html)`).join(" ");

    await run(loader, thread([turn("agt-2-0a1b", markdown)]), new AgentArtifactCaptureLedger());

    expect(loader.resolve).toHaveBeenCalledTimes(32);
  });

  it("evicts the oldest settled entry once the ledger is full", async () => {
    const loader = captured();
    const ledger = new AgentArtifactCaptureLedger();
    const first = thread([turn("agt-2-0a1b", "[Preview](first.html)")]);
    await run(loader, first, ledger);

    for (let index = 0; index < AGENT_ARTIFACT_CAPTURE_LEDGER_LIMIT; index += 1) {
      await run(loader, thread([turn(`agt-${index + 10}-0a1b`, "[Preview](design.html)")]), ledger);
    }
    const calls = vi.mocked(loader.resolve).mock.calls.length;
    await run(loader, first, ledger);

    expect(vi.mocked(loader.resolve).mock.calls.length).toBe(calls + 1);
  });
});
