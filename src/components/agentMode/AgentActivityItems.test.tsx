// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AgentToolDisclosureContext, useAgentTurnToolDisclosure } from "./AgentToolDisclosure";
import { AgentActivityItems } from "./AgentActivityItems";
import type { AgentActivityTool } from "./agentActivityGrouping";
function activityTool(index: number, patch: Partial<AgentActivityTool> = {}): AgentActivityTool {
  return {
    kind: "tool",
    key: `e${index}`,
    toolId: `tool-${index}`,
    name: "Bash",
    rowKind: "command",
    status: "ok",
    inputSummary: "npm test",
    outcome: { isError: false, outputSummary: "ok" },
    label: `Command ${index}`,
    argument: null,
    command: "npm test",
    output: "ok",
    ...patch,
  };
}

import type { AgentTurnItem } from "./agentModePresentation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function fixture() {
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (items: ReadonlyArray<AgentTurnItem>) =>
    act(() =>
      root.render(
        <AgentActivityItems
          items={items}
          currentEventKey={null}
          renderItem={(item) => (
            <span data-tool={item.key}>{item.kind === "tool" ? item.label : item.kind}</span>
          )}
        />,
      ),
    );
  return { host, render, close: () => act(() => root.unmount()) };
}

describe("AgentActivityItems", () => {
  it("bounds 1000 activities to a single collapsed row or 50 expanded rows, preserving disclosure while streaming", () => {
    const view = fixture();
    try {
      const rows = Array.from({ length: 1000 }, (_, index) => activityTool(index));
      view.render(rows);
      expect(view.host.querySelectorAll("[data-tool]")).toHaveLength(0);
      const button = view.host.querySelector("button")!;
      expect(button.textContent).toContain("Ran 1000 commands");
      act(() => button.click());
      expect(view.host.querySelectorAll("[data-tool]")).toHaveLength(50);
      const next = [...view.host.querySelectorAll("button")].find(
        (element) => element.textContent === "Next",
      )!;
      act(() => next.click());
      expect(view.host.querySelector("[data-tool]")?.getAttribute("data-tool")).toBe("e50");
      view.render([...rows, activityTool(1000)]);
      expect(view.host.querySelectorAll("[data-tool]")).toHaveLength(50);
      expect(view.host.querySelector("[data-tool]")?.getAttribute("data-tool")).toBe("e50");
    } finally {
      view.close();
    }
  });
  it("shows the latest live command outside an expanded history page", () => {
    const view = fixture();
    try {
      view.render(
        Array.from({ length: 100 }, (_, index) =>
          activityTool(index, index === 99 ? { status: "running", outcome: null } : {}),
        ),
      );
      act(() => view.host.querySelector("button")!.click());
      expect(view.host.querySelector('[data-tool="e99"]')).not.toBeNull();
      expect(view.host.querySelectorAll("[data-tool]")).toHaveLength(51);
    } finally {
      view.close();
    }
  });

  it("isolates identical tool IDs between child sessions sharing a turn", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    function Shared() {
      const disclosure = useAgentTurnToolDisclosure();
      return (
        <AgentToolDisclosureContext.Provider value={disclosure}>
          {["child-a", "child-b"].map((scope) => (
            <AgentActivityItems
              key={scope}
              scope={scope}
              items={[activityTool(0), activityTool(1)]}
              currentEventKey={null}
              renderItem={(item) => <span data-child={scope}>{item.key}</span>}
            />
          ))}
        </AgentToolDisclosureContext.Provider>
      );
    }
    try {
      act(() => root.render(<Shared />));
      act(() => host.querySelector("button")!.click());
      expect(host.querySelectorAll('[data-child="child-a"]')).toHaveLength(2);
      expect(host.querySelectorAll('[data-child="child-b"]')).toHaveLength(0);
    } finally {
      act(() => root.unmount());
    }
  });

  it("keeps live and failed activity visible while collapsed and avoids inferred success", () => {
    const view = fixture();
    try {
      view.render([
        activityTool(0, { outcome: null }),
        activityTool(1, { outcome: null }),
        activityTool(2, { status: "error" }),
        activityTool(3),
        activityTool(4, { status: "running", outcome: null }),
      ]);
      expect(view.host.querySelector('[data-tool="e2"]')).not.toBeNull();
      expect(view.host.querySelector('[data-tool="e4"]')).not.toBeNull();
      expect(view.host.querySelector("button")?.textContent).not.toContain("completed");
      expect(view.host.textContent).toContain("1 running");
    } finally {
      view.close();
    }
  });
});
