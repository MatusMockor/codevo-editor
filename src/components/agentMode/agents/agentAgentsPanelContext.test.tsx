// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_AGENT_RUNTIME_SUBAGENTS } from "../../../domain/agentRuntimeSubagent";
import { createAgentElapsedTicker } from "../agentElapsedTicker";
import type { AgentThreadAgents } from "../useAgentThreadAgents";
import { AgentAgentsPanelProvider } from "./agentAgentsPanelContext";
import { useAgentAgentsPanelControls, usePublishAgentThreadAgents } from "./agentAgentsPanelHooks";

function agents(threadId: string, working: number): AgentThreadAgents {
  return {
    threadId,
    groups: [],
    tracked: working > 0,
    working,
    counts: { working, idle: 0, completed: 0, failed: 0, stopped: 0, unknown: 0 },
    truncated: false,
    ticker: createAgentElapsedTicker(),
    openPanel: () => undefined,
    subagentsFor: () => EMPTY_AGENT_RUNTIME_SUBAGENTS,
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Publisher({ value }: { readonly value: AgentThreadAgents | null }) {
  return value === null ? null : <Publish value={value} />;
}

function Publish({ value }: { readonly value: AgentThreadAgents }) {
  usePublishAgentThreadAgents(value);
  return null;
}

function Reader() {
  const controls = useAgentAgentsPanelControls();
  return (
    <button onClick={controls.toggle} type="button">
      {`${controls.isOpen}:${controls.working}`}
    </button>
  );
}

describe("agents panel context", () => {
  it("publishes the session's agents to the top bar and unpublishes on unmount", () => {
    const toggle = vi.fn();
    const render = (value: AgentThreadAgents | null, isOpen = false) =>
      act(() =>
        root.render(
          <AgentAgentsPanelProvider isOpen={isOpen} onOpen={() => undefined} onToggle={toggle}>
            <Publisher value={value} />
            <Reader />
          </AgentAgentsPanelProvider>,
        ),
      );
    render(agents("thread-a", 2));
    expect(host.textContent).toBe("false:2");
    render(agents("thread-b", 0), true);
    expect(host.textContent).toBe("true:0");
    render(null);
    expect(host.textContent).toBe("false:0");
    act(() => host.querySelector("button")?.click());
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("is inert outside a provider", () => {
    act(() => root.render(<Reader />));
    expect(host.textContent).toBe("false:0");
    act(() => host.querySelector("button")?.click());
    expect(host.textContent).toBe("false:0");
  });
});
