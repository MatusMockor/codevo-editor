// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  type AgentThreadBranchMemory,
} from "../domain/agentThreadBranchMemory";
import type { AgentThreadBranchMemoryPort } from "./agentThreadBranchMemoryPort";
import { useAgentThreadBranchMemory } from "./useAgentThreadBranchMemory";

class InMemoryPort implements AgentThreadBranchMemoryPort {
  saved: AgentThreadBranchMemory = EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  saves = 0;
  load(): AgentThreadBranchMemory {
    return this.saved;
  }
  save(memory: AgentThreadBranchMemory): void {
    this.saved = memory;
    this.saves += 1;
  }
}

const THREAD = { threadId: "t-1", rootKey: "/repo", ownerId: "w1" };

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderHook(port: AgentThreadBranchMemoryPort | null) {
  const result: { current: ReturnType<typeof useAgentThreadBranchMemory> | null } = {
    current: null,
  };
  function Probe() {
    result.current = useAgentThreadBranchMemory(port);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  unmounts.push(() => act(() => root.unmount()));
  return {
    get current() {
      expect(result.current).not.toBeNull();
      return result.current!;
    },
  };
}

describe("useAgentThreadBranchMemory", () => {
  it("remembers, persists and reloads a thread's branch", () => {
    const port = new InMemoryPort();
    const result = renderHook(port);
    act(() => result.current.remember(THREAD, "main"));
    expect(result.current.branchOf(THREAD)).toBe("main");
    expect(port.saves).toBe(1);
    const reloaded = renderHook(port);
    expect(reloaded.current.branchOf(THREAD)).toBe("main");
  });

  it("does not persist a no-op or an invalid branch", () => {
    const port = new InMemoryPort();
    const result = renderHook(port);
    act(() => result.current.remember(THREAD, "main"));
    act(() => result.current.remember(THREAD, "main"));
    act(() => result.current.remember(THREAD, ""));
    expect(port.saves).toBe(1);
  });

  it("works without a port", () => {
    const result = renderHook(null);
    act(() => result.current.remember(THREAD, "dev"));
    expect(result.current.branchOf(THREAD)).toBe("dev");
  });
});
