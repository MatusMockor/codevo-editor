// @vitest-environment jsdom

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTurnEvent } from "../domain/agentThread";
import type {
  AgentTurnLogLease,
  AppendAgentTurnLogReceipt,
  AppendAgentTurnLogRequest,
  OpenAgentTurnLogRequest,
} from "../domain/agentTurnLog";
import type {
  AgentTurnLogGateway,
  AgentTurnLogTimers,
  OpenAgentTurnLogSlotRequest,
} from "./agentTurnLogPorts";
import {
  MAX_TRACKED_OPEN_AGENT_TURN_LOGS,
  createAgentTurnLogLifecycle,
  useAgentTurnLogging,
  type AgentTurnLogIntegration,
  type AgentTurnLoggingDependencies,
} from "./useAgentTurnLogging";

const ROOT_KEY = "/workspace/app";
const TURN_ID = "agt-1-0a1c";

function project(generation = 1): AgentProjectDescriptor {
  return {
    rootKey: ROOT_KEY,
    rootPath: ROOT_KEY,
    ownerId: agentRootOwnerId(ROOT_KEY),
    label: "app",
    generation,
    trust: "trusted",
    origin: "active-tab",
    repositories: [],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function openRequest(generation = 1): OpenAgentTurnLogSlotRequest {
  return {
    scope: {
      rootKey: ROOT_KEY,
      ownerId: agentRootOwnerId(ROOT_KEY),
      threadId: "agt-1-0a1b",
      turnId: TURN_ID,
    },
    generation,
    provider: "claudeCode",
    priorLoss: { kind: "none" },
    prompt: null,
  };
}

const tool = (index: number): AgentTurnEvent => ({
  kind: "toolCall",
  toolId: `tool-${index}`,
  name: "Bash",
  inputSummary: `run ${index}`,
});

const result = (text: string): AgentTurnEvent => ({
  kind: "result",
  text,
  isError: false,
  usage: null,
});

interface PersistentLogGateway extends AgentTurnLogGateway {
  readonly opens: OpenAgentTurnLogRequest[];
  readonly appends: AppendAgentTurnLogRequest[];
  readonly rows: Map<number, AgentTurnEvent>;
}

function persistentLogGateway(): PersistentLogGateway {
  const opens: OpenAgentTurnLogRequest[] = [];
  const appends: AppendAgentTurnLogRequest[] = [];
  const rows = new Map<number, AgentTurnEvent>();
  let writerEpoch = 0;
  const nextSeq = (): number => Math.max(0, ...rows.keys()) + 1;
  return {
    opens,
    appends,
    rows,
    async openTurnLog(request): Promise<AgentTurnLogLease> {
      opens.push(request);
      writerEpoch += 1;
      return { writerEpoch, nextSeq: nextSeq(), digest: null, digestThroughSeq: 0 };
    },
    async appendTurnLog(request): Promise<AppendAgentTurnLogReceipt> {
      if (request.writerEpoch !== writerEpoch) throw new Error("supersededWriter");
      if (request.expectedNextSeq !== nextSeq()) throw new Error(`sequenceGap:${nextSeq()}`);
      appends.push(request);
      for (const op of request.ops) rows.set(op.seq, op.event);
      return {
        persistedThroughSeq: nextSeq() - 1,
        nextSeq: nextSeq(),
        turnBytes: 0,
        budget: "ok",
      };
    },
    async readTurnLogPage() {
      throw new Error("not used");
    },
    async summarizeTurnLogs() {
      return [];
    },
    async deleteThreadLog() {
      return { deleted: false };
    },
  };
}

function manualTimers() {
  const pending = new Map<number, { at: number; run: () => void }>();
  let handle = 0;
  const state = { clock: 0 };
  const timers: AgentTurnLogTimers = {
    now: () => state.clock,
    schedule: (run, delayMs) => {
      handle += 1;
      const key = handle;
      pending.set(key, { at: state.clock + delayMs, run });
      return () => pending.delete(key);
    },
  };
  const advance = (ms: number): void => {
    state.clock += ms;
    for (const [key, entry] of [...pending]) {
      if (entry.at > state.clock) continue;
      pending.delete(key);
      entry.run();
    }
  };
  return { timers, advance };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

function renderLogging(gateway: AgentTurnLogGateway, timers: AgentTurnLogTimers, strict: boolean) {
  const captured: { value: AgentTurnLogIntegration | null; identities: Set<unknown> } = {
    value: null,
    identities: new Set(),
  };
  function Probe() {
    captured.value = useAgentTurnLogging({ gateway, projects: [project()], timers });
    captured.identities.add(captured.value);
    captured.identities.add(captured.value.writer);
    captured.identities.add(captured.value.facts);
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  const tree = strict ? (
    <StrictMode>
      <Probe />
    </StrictMode>
  ) : (
    <Probe />
  );
  const render = () => act(() => root.render(tree));
  render();
  return {
    integration: () => captured.value as AgentTurnLogIntegration,
    identities: captured.identities,
    render,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentTurnLogging lifetime", () => {
  it("keeps a working writer after the StrictMode mount, cleanup, mount cycle", async () => {
    const gateway = persistentLogGateway();
    const clock = manualTimers();
    const harness = renderLogging(gateway, clock.timers, true);
    await settle();

    harness.integration().writer.openTurn(openRequest());
    await settle();
    expect(gateway.opens).toHaveLength(1);
    expect(harness.integration().writer.status(TURN_ID)?.state).toEqual({ kind: "writing" });

    harness.integration().writer.recordEvents(TURN_ID, [tool(1), tool(2)]);
    clock.advance(1_000);
    await settle();
    expect([...gateway.rows.values()]).toEqual([tool(1), tool(2)]);
    expect(harness.integration().facts.factsOf(TURN_ID)?.live).toBe(true);

    harness.render();
    expect(harness.identities.size).toBe(3);
    await harness.unmount();
  });

  it("continues a live turn across a remount without losing or repeating a row", async () => {
    const gateway = persistentLogGateway();
    const clock = manualTimers();
    const dependenciesRef: { current: AgentTurnLoggingDependencies } = {
      current: { gateway, projects: [project()], timers: clock.timers, now: clock.timers.now },
    };
    const lifecycle = createAgentTurnLogLifecycle(dependenciesRef);
    const { writer } = lifecycle.integration;
    lifecycle.mount();

    writer.openTurn(openRequest());
    await settle();
    writer.recordEvents(TURN_ID, [tool(1), tool(2)]);
    clock.advance(1_000);
    await settle();
    expect([...gateway.rows.keys()]).toEqual([1, 2]);

    writer.recordEvents(TURN_ID, [tool(3)]);
    lifecycle.unmount();
    lifecycle.mount();
    writer.recordEvents(TURN_ID, [tool(4)]);
    await settle();
    writer.recordEvents(TURN_ID, [tool(5), result("done")]);
    await settle();
    clock.advance(1_000);
    await settle();

    expect(gateway.opens).toHaveLength(2);
    expect([...gateway.rows.entries()]).toEqual([
      [1, tool(1)],
      [2, tool(2)],
      [3, tool(3)],
      [4, tool(4)],
      [5, tool(5)],
      [6, result("done")],
    ]);
    const persistedSeqs = gateway.appends.flatMap((append) => append.ops.map((op) => op.seq));
    expect(persistedSeqs).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lifecycle.integration.facts.factsOf(TURN_ID)?.live).toBe(true);
    lifecycle.unmount();
  });

  it("still records the status of a turn whose open request aged out of the tracked window", async () => {
    const gateway = persistentLogGateway();
    const clock = manualTimers();
    const dependenciesRef: { current: AgentTurnLoggingDependencies } = {
      current: { gateway, projects: [project()], timers: clock.timers, now: clock.timers.now },
    };
    const lifecycle = createAgentTurnLogLifecycle(dependenciesRef);
    const { facts, writer } = lifecycle.integration;
    lifecycle.mount();

    const oldest = "agt-1-turn-0";
    for (let index = 0; index < MAX_TRACKED_OPEN_AGENT_TURN_LOGS + 6; index += 1) {
      const request = openRequest();
      writer.openTurn({ ...request, scope: { ...request.scope, turnId: `agt-1-turn-${index}` } });
    }
    await settle();
    expect(facts.factsOf(oldest)).toBeNull();

    writer.reportLoss(oldest, { kind: "supervisorGap" });
    await settle();

    expect(facts.threadIdOf(oldest)).toBe(openRequest().scope.threadId);
    expect(facts.factsOf(oldest)?.loss).toEqual({ kind: "supervisorGap" });
    lifecycle.unmount();
  });

  it("re-opens a live turn under the project generation that is current at the remount", async () => {
    const gateway = persistentLogGateway();
    const clock = manualTimers();
    const dependenciesRef: { current: AgentTurnLoggingDependencies } = {
      current: { gateway, projects: [project(1)], timers: clock.timers },
    };
    const lifecycle = createAgentTurnLogLifecycle(dependenciesRef);
    lifecycle.mount();
    lifecycle.integration.writer.openTurn(openRequest(1));
    await settle();

    lifecycle.unmount();
    dependenciesRef.current = { ...dependenciesRef.current, projects: [project(2)] };
    lifecycle.mount();
    await settle();
    lifecycle.integration.writer.recordEvents(TURN_ID, [result("done")]);
    await settle();
    expect([...gateway.rows.values()]).toEqual([result("done")]);

    lifecycle.unmount();
    dependenciesRef.current = { ...dependenciesRef.current, projects: [] };
    lifecycle.mount();
    await settle();
    expect(gateway.opens).toHaveLength(2);
    lifecycle.unmount();
  });

  it("ignores a call that arrives after the final unmount", async () => {
    const gateway = persistentLogGateway();
    const clock = manualTimers();
    const harness = renderLogging(gateway, clock.timers, false);
    const integration = harness.integration();
    await harness.unmount();
    integration.writer.openTurn(openRequest());
    await settle();
    expect(gateway.opens).toHaveLength(0);
    expect(integration.writer.status(TURN_ID)).toBeNull();
  });
});

describe("useAgentTurnLogging quit flush", () => {
  it("flushes every open slot on pagehide and stops listening after unmount", async () => {
    const gateway = persistentLogGateway();
    const clock = manualTimers();
    const harness = renderLogging(gateway, clock.timers, false);
    harness.integration().writer.openTurn(openRequest());
    await settle();
    harness.integration().writer.recordEvents(TURN_ID, [tool(1), tool(2)]);
    expect(gateway.rows.size).toBe(0);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect([...gateway.rows.values()]).toEqual([tool(1), tool(2)]);

    harness.integration().writer.recordEvents(TURN_ID, [tool(3)]);
    await harness.unmount();
    await settle();
    expect([...gateway.rows.values()]).toEqual([tool(1), tool(2), tool(3)]);

    const appendsAfterUnmount = gateway.appends.length;
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect(gateway.appends).toHaveLength(appendsAfterUnmount);
  });
});
