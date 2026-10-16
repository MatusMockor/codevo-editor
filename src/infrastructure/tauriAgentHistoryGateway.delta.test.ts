import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "../domain/agentThread";
import { serializeAgentHistoryThread } from "../domain/agentThreadWire";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
import {
  MIN_AGENT_HISTORY_DELTA_RETAINED_BYTES,
  TauriAgentHistoryGateway,
} from "./tauriAgentHistoryGateway";
import { prepareAgentHistoryThreadWrite } from "./tauriAgentHistoryIpcContract";
import type { InvokeAgentThreadStoreCommand } from "./tauriAgentThreadStoreIpcContract";

const FULL = "save_agent_history_thread";
const DELTA = "save_agent_history_turn_delta";
const UTF8 = new TextEncoder();

type Edit =
  | { readonly kind: "copy"; readonly start: number; readonly count: number }
  | { readonly kind: "insert"; readonly events: ReadonlyArray<unknown> };

interface WireRequest {
  readonly expectedRevision: number;
  readonly thread: {
    readonly title: string;
    readonly turns: ReadonlyArray<{ readonly turnId: string; readonly events: unknown[] }>;
  };
  readonly delta?: {
    readonly baseEventCount: number;
    readonly baseEventsDigest: string;
    readonly edits: ReadonlyArray<Edit>;
  };
}

interface Call {
  readonly command: string;
  readonly request: WireRequest;
  readonly bytes: number;
}

class FakeHistoryBackend {
  revision = 0;
  title = "";
  lastWrite: string | null = null;
  readonly turns = new Map<string, unknown[]>();
  readonly calls: Call[] = [];
  loseNextReceipt: string | null = null;

  readonly invoke: InvokeAgentThreadStoreCommand = async (command, args) => {
    const request = args.request as WireRequest;
    this.calls.push({ command, request, bytes: UTF8.encode(JSON.stringify(args)).byteLength });
    const identity = `${command}:${JSON.stringify(request)}`;
    if (this.revision === request.expectedRevision + 1 && this.lastWrite === identity) {
      const eventsDigest = this.digestOf(request.thread.turns);
      return command === DELTA
        ? { kind: "saved", revision: this.revision, eventsDigest }
        : { revision: this.revision, eventsDigest };
    }
    if (command !== FULL && command !== DELTA) throw new Error(`unexpected command ${command}`);
    const receipt = command === FULL ? this.full(request, identity) : this.delta(request, identity);
    if (this.loseNextReceipt === command) {
      this.loseNextReceipt = null;
      throw new Error("IPC receipt lost");
    }
    return receipt;
  };

  private full(request: WireRequest, identity: string) {
    if (request.expectedRevision !== this.revision)
      throw "The saved thread update is stale; reload its current revision.";
    for (const turn of request.thread.turns) this.turns.set(turn.turnId, [...turn.events]);
    const revision = this.commit(request, identity);
    return { revision, eventsDigest: this.digestOf(request.thread.turns) };
  }

  private delta(request: WireRequest, identity: string) {
    if (request.expectedRevision !== this.revision)
      return { kind: "needsFullSave", reason: "baseMismatch" };
    const turn = request.thread.turns[0]!;
    expect(turn.events).toEqual([]);
    const stored = this.turns.get(turn.turnId);
    if (stored === undefined) return { kind: "needsFullSave", reason: "missingBase" };
    if (
      stored.length !== request.delta!.baseEventCount ||
      digest(stored) !== request.delta!.baseEventsDigest
    )
      return { kind: "needsFullSave", reason: "baseMismatch" };
    const events = request.delta!.edits.flatMap((edit) =>
      edit.kind === "copy" ? stored.slice(edit.start, edit.start + edit.count) : [...edit.events],
    );
    this.turns.set(turn.turnId, events);
    return {
      kind: "saved",
      revision: this.commit(request, identity),
      eventsDigest: digest(events),
    };
  }

  private digestOf(turns: WireRequest["thread"]["turns"]): string | null {
    const [turn, ...rest] = turns;
    if (turn === undefined || rest.length > 0) return null;
    return digest(this.turns.get(turn.turnId)!);
  }

  private commit(request: WireRequest, identity: string): number {
    this.title = request.thread.title;
    this.revision += 1;
    this.lastWrite = identity;
    return this.revision;
  }
}

function digest(events: ReadonlyArray<unknown>): string {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex");
}

function textEvents(count: number, label: string, bytes = 1_024): AgentTurnEvent[] {
  return Array.from({ length: count }, (_unused, index) => ({
    kind: "assistantText" as const,
    text: `${label}-${index}-`.padEnd(bytes, "x"),
  }));
}

function runningTurn(events: ReadonlyArray<AgentTurnEvent>, overrides: Partial<AgentTurn> = {}) {
  return logTurn({
    status: { kind: "running" },
    endedAtEpochMs: null,
    events,
    ...overrides,
  });
}

function saveRequest(thread: AgentThread) {
  const ownerId = agentRootOwnerId(thread.owner.rootKey);
  return {
    rootKey: thread.owner.rootKey,
    ownerId,
    thread: { ...thread, owner: { ...thread.owner, ownerId } },
    loggedPromptTurnIds: [],
  };
}

function withEvents(thread: AgentThread, events: ReadonlyArray<AgentTurnEvent>): AgentThread {
  const turns = thread.turns.map((turn, index) =>
    index === thread.turns.length - 1 ? { ...turn, events } : turn,
  );
  return { ...thread, turns };
}

function fullProjection(thread: AgentThread, turnId: string): unknown[] {
  const document = serializeAgentHistoryThread(thread) as {
    turns: ReadonlyArray<{ turnId: string; events: unknown[] }>;
  };
  return document.turns.find((turn) => turn.turnId === turnId)!.events;
}

async function seeded(events = textEvents(64, "seed")) {
  const backend = new FakeHistoryBackend();
  const gateway = new TauriAgentHistoryGateway(backend.invoke, () => true);
  const thread = logThread({ turns: [runningTurn(events)] });
  await gateway.saveAgentThread(saveRequest(thread));
  return { backend, gateway, thread };
}

describe("incremental agent history saves", () => {
  it("sends only appended events once a turn base is acknowledged", async () => {
    const { backend, gateway, thread } = await seeded();
    const appended = textEvents(3, "new");
    const next = withEvents(thread, [...thread.turns[0]!.events, ...appended]);

    await gateway.saveAgentThread(saveRequest(next));

    expect(backend.calls.map((call) => call.command)).toEqual([FULL, DELTA]);
    const delta = backend.calls[1]!.request;
    expect(delta.expectedRevision).toBe(1);
    expect(delta.delta).toEqual({
      baseEventCount: 64,
      baseEventsDigest: digest(fullProjection(thread, thread.turns[0]!.turnId)),
      edits: [
        { kind: "copy", start: 0, count: 64 },
        { kind: "insert", events: fullProjection(next, next.turns[0]!.turnId).slice(64) },
      ],
    });
    expect(backend.turns.get(next.turns[0]!.turnId)).toEqual(
      fullProjection(next, next.turns[0]!.turnId),
    );
    expect(backend.revision).toBe(2);
  });

  it("carries changed thread and turn scalars in the bounded header", async () => {
    const { backend, gateway, thread } = await seeded();
    const turn = thread.turns[0]!;
    const next: AgentThread = {
      ...thread,
      title: "Renamed",
      viewedAtEpochMs: 99,
      turns: [{ ...turn, status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: 50 }],
    };

    await gateway.saveAgentThread(saveRequest(next));

    const call = backend.calls[1]!;
    expect(call.command).toBe(DELTA);
    expect(call.request.delta!.edits).toEqual([{ kind: "copy", start: 0, count: 64 }]);
    expect(call.request.thread).toMatchObject({
      title: "Renamed",
      viewedAtEpochMs: 99,
      turns: [{ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: 50, events: [] }],
    });
    expect(backend.title).toBe("Renamed");
    expect(call.bytes).toBeLessThan(2_048);
  });

  it("writes a new turn in full and leaves acknowledged turns untouched", async () => {
    const { backend, gateway, thread } = await seeded();
    const second = runningTurn(textEvents(2, "second"), { turnId: "agt-1-0a1d" });
    const next = { ...thread, turns: [thread.turns[0]!, second] };

    await gateway.saveAgentThread(saveRequest(next));

    expect(backend.calls.map((call) => call.command)).toEqual([FULL, FULL]);
    expect(backend.calls[1]!.request.thread.turns.map((turn) => turn.turnId)).toEqual([
      "agt-1-0a1d",
    ]);
  });

  it("falls back to an immediate full save at the same revision when the base is refused", async () => {
    const { backend, gateway, thread } = await seeded();
    const turnId = thread.turns[0]!.turnId;
    backend.turns.set(turnId, backend.turns.get(turnId)!.slice(1));
    const next = withEvents(thread, [...thread.turns[0]!.events, ...textEvents(2, "new")]);

    await gateway.saveAgentThread(saveRequest(next));

    expect(backend.calls.map((call) => [call.command, call.request.expectedRevision])).toEqual([
      [FULL, 0],
      [DELTA, 1],
      [FULL, 1],
    ]);
    expect(backend.turns.get(turnId)).toEqual(fullProjection(next, turnId));

    const later = withEvents(next, [...next.turns[0]!.events, ...textEvents(1, "later")]);
    await gateway.saveAgentThread(saveRequest(later));
    expect(backend.calls[3]!.command).toBe(DELTA);
    expect(backend.turns.get(turnId)).toEqual(fullProjection(later, turnId));
  });

  it("replays an uncertain delta exactly before building on its base", async () => {
    const { backend, gateway, thread } = await seeded();
    const turnId = thread.turns[0]!.turnId;
    const next = withEvents(thread, [...thread.turns[0]!.events, ...textEvents(2, "new")]);
    backend.loseNextReceipt = DELTA;

    await expect(gateway.saveAgentThread(saveRequest(next))).rejects.toThrow("IPC receipt lost");
    const later = withEvents(next, [...next.turns[0]!.events, ...textEvents(1, "later")]);
    await gateway.saveAgentThread(saveRequest(later));

    const commands = backend.calls.map((call) => call.command);
    expect(commands).toEqual([FULL, DELTA, DELTA, DELTA]);
    expect(backend.calls[2]!.request).toEqual(backend.calls[1]!.request);
    expect(backend.calls[3]!.request.delta!.baseEventCount).toBe(66);
    expect(backend.calls[3]!.request.expectedRevision).toBe(2);
    expect(backend.turns.get(turnId)).toEqual(fullProjection(later, turnId));
  });

  it("acknowledges a base only after its write receipt arrives", async () => {
    const backend = new FakeHistoryBackend();
    const gateway = new TauriAgentHistoryGateway(backend.invoke, () => true);
    const thread = logThread({ turns: [runningTurn(textEvents(64, "seed"))] });
    backend.loseNextReceipt = FULL;

    await expect(gateway.saveAgentThread(saveRequest(thread))).rejects.toThrow("IPC receipt lost");
    const next = withEvents(thread, [...thread.turns[0]!.events, ...textEvents(1, "new")]);
    await gateway.saveAgentThread(saveRequest(next));

    expect(backend.calls.map((call) => [call.command, call.request.expectedRevision])).toEqual([
      [FULL, 0],
      [FULL, 0],
      [DELTA, 1],
    ]);
    expect(backend.calls[1]!.request).toEqual(backend.calls[0]!.request);
    expect(backend.calls[2]!.request.delta!.baseEventCount).toBe(64);
  });

  it("resets every turn base when the thread is reloaded", async () => {
    const backend = new FakeHistoryBackend();
    const load: InvokeAgentThreadStoreCommand = async (command, args) => {
      if (command !== "load_agent_history") return backend.invoke(command, args);
      return {
        threads: [serializeAgentHistoryThread(thread)],
        unreadable: [],
        evicted: 0,
        revisions: { [thread.threadId]: backend.revision },
        haltRequests: {},
      };
    };
    const gateway = new TauriAgentHistoryGateway(load, () => true);
    const thread = logThread({ turns: [runningTurn(textEvents(64, "seed"))] });
    await gateway.saveAgentThread(saveRequest(thread));
    const next = withEvents(thread, [...thread.turns[0]!.events, ...textEvents(1, "new")]);
    await gateway.saveAgentThread(saveRequest(next));
    expect(backend.calls.map((call) => call.command)).toEqual([FULL, DELTA]);

    await gateway.loadAgentThreads({
      rootKey: thread.owner.rootKey,
      ownerId: agentRootOwnerId(thread.owner.rootKey),
    });
    const later = withEvents(next, [...next.turns[0]!.events, ...textEvents(1, "later")]);
    await gateway.saveAgentThread(saveRequest({ ...later, historyRevision: 2 }));

    expect(backend.calls.map((call) => call.command)).toEqual([FULL, DELTA, FULL]);
    expect(backend.calls[2]!.request.expectedRevision).toBe(2);
  });

  it("keeps bases owner-scoped so another root never reuses them", async () => {
    const { backend, gateway, thread } = await seeded();
    const foreignRoot = "/workspace/other";
    const foreign: AgentThread = withEvents(
      {
        ...thread,
        owner: {
          rootKey: foreignRoot,
          ownerId: agentRootOwnerId(foreignRoot),
          repositoryRoot: foreignRoot,
        },
        target: { isolation: "worktree", worktreePath: `${foreignRoot}/.worktrees/one` },
      },
      [...thread.turns[0]!.events, ...textEvents(1, "new")],
    );
    backend.revision = 0;

    await gateway.saveAgentThread(saveRequest(foreign));

    expect(backend.calls.slice(-1)[0]!.command).toBe(FULL);
  });

  it("uses full writes for small turns and threads that still carry imported history", async () => {
    const small = await seeded(textEvents(4, "small", 64));
    const nextSmall = withEvents(small.thread, [
      ...small.thread.turns[0]!.events,
      ...textEvents(1, "new", 64),
    ]);
    await small.gateway.saveAgentThread(saveRequest(nextSmall));
    expect(small.backend.calls.map((call) => call.command)).toEqual([FULL, FULL]);
    expect(64 * 4).toBeLessThan(MIN_AGENT_HISTORY_DELTA_RETAINED_BYTES);

    const imported = await seeded();
    const origin = {
      provider: "claudeCode" as const,
      sessionId: "11111111-1111-4111-8111-111111111111",
      importedAtEpochMs: 5,
      history: {
        provider: "claudeCode" as const,
        sessionId: "11111111-1111-4111-8111-111111111111",
        exchanges: [{ role: "user" as const, text: "hello" }],
        exchangesTruncated: false,
        totalPreviewBytes: 5,
      },
    };
    const withHistory = withEvents({ ...imported.thread, externalOrigin: origin }, [
      ...imported.thread.turns[0]!.events,
      ...textEvents(1, "new"),
    ]);
    await imported.gateway.saveAgentThread(saveRequest(withHistory));
    expect(imported.backend.calls.slice(-1)[0]!.command).toBe(FULL);
  });

  it("refuses to copy from a stored turn another writer replaced with the same event count", async () => {
    const { backend, gateway, thread } = await seeded();
    const turnId = thread.turns[0]!.turnId;
    backend.turns.set(turnId, textEvents(64, "foreign"));
    const next = withEvents(thread, [...thread.turns[0]!.events, ...textEvents(1, "new")]);

    await gateway.saveAgentThread(saveRequest(next));

    expect(backend.calls.map((call) => call.command)).toEqual([FULL, DELTA, FULL]);
    expect(backend.turns.get(turnId)).toEqual(fullProjection(next, turnId));
  });

  it("drops cached bases when another writer's revision is adopted", async () => {
    const backend = new FakeHistoryBackend();
    const revisions: number[] = [];
    const durable = (thread: AgentThread) => ({
      ...saveRequest(thread),
      onRevision: (revision: number) => revisions.push(revision),
    });
    const first = new TauriAgentHistoryGateway(backend.invoke, () => true);
    const second = new TauriAgentHistoryGateway(backend.invoke, () => true);
    const cached = logThread({ turns: [runningTurn(textEvents(64, "a"))] });
    await first.saveAgentThread(durable(cached));
    const foreign = logThread({
      historyRevision: 1,
      turns: [runningTurn(textEvents(64, "x"), { lastOutputSequence: 3 })],
    });
    await second.saveAgentThread(durable(foreign));
    const turnId = cached.turns[0]!.turnId;
    const adopted = withEvents({ ...cached, historyRevision: 2 }, [
      ...cached.turns[0]!.events,
      ...textEvents(1, "c"),
    ]);

    await first.saveAgentThread(durable(adopted));

    expect(revisions).toEqual([1, 2, 3]);
    expect(backend.calls.map((call) => [call.command, call.request.expectedRevision])).toEqual([
      [FULL, 0],
      [FULL, 1],
      [FULL, 2],
    ]);
    expect(backend.turns.get(turnId)).toEqual(fullProjection(adopted, turnId));
  });

  it("keeps a base only while its turn is still running", async () => {
    const { backend, gateway, thread } = await seeded();
    const turn = thread.turns[0]!;
    const settled: AgentThread = {
      ...thread,
      turns: [
        {
          ...turn,
          events: [...turn.events, ...textEvents(1, "last")],
          status: { kind: "exited", exitCode: 0 },
          endedAtEpochMs: 50,
        },
      ],
    };
    await gateway.saveAgentThread(saveRequest(settled));
    const renamed: AgentThread = {
      ...settled,
      turns: [{ ...settled.turns[0]!, cliVersion: "1.2.3" }],
    };

    await gateway.saveAgentThread(saveRequest(renamed));

    expect(backend.calls.map((call) => call.command)).toEqual([FULL, DELTA, FULL]);
  });

  it("cuts bytes sent per coalesced save of a long streaming turn", async () => {
    const { backend, gateway, thread } = await seeded(textEvents(400, "seed"));
    let current = thread;
    let fullBytes = 0;
    for (let save = 0; save < 10; save += 1) {
      current = withEvents(current, [
        ...current.turns[0]!.events,
        ...textEvents(4, `save-${save}`),
      ]);
      const owner = saveRequest(current);
      const write = prepareAgentHistoryThreadWrite(
        owner,
        { ...owner.thread, turns: [owner.thread.turns[0]!] },
        backend.revision,
      );
      fullBytes += UTF8.encode(JSON.stringify({ request: write })).byteLength;
      await gateway.saveAgentThread(owner);
    }

    const deltaCalls = backend.calls.slice(1);
    const deltaBytes = deltaCalls.reduce((total, call) => total + call.bytes, 0);
    expect(deltaCalls.every((call) => call.command === DELTA)).toBe(true);
    expect(backend.turns.get(current.turns[0]!.turnId)).toEqual(
      fullProjection(current, current.turns[0]!.turnId),
    );
    expect(fullBytes / 10).toBeGreaterThan(400 * 1_024);
    expect(deltaBytes / 10).toBeLessThan(6 * 1_024);
  });
});
