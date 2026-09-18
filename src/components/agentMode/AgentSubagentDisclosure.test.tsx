// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { AgentSubagentDisclosure } from "./AgentSubagentDisclosure";
import type { AgentSubagentDisclosureEntry } from "./agentSubagentDisclosurePresentation";

describe("AgentSubagentDisclosure", () => {
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
  const entry: AgentSubagentDisclosureEntry = {
    toolId: "a",
    name: "Reviewer",
    description: "Review settings",
    state: "running",
  };
  it("starts collapsed and preserves independent expansion while statuses update", () => {
    act(() => root.render(<AgentSubagentDisclosure entries={[entry]} />));
    const outer = host.querySelector<HTMLDetailsElement>(".agent-subagent-disclosure")!;
    const member = host.querySelector<HTMLDetailsElement>(".agent-subagent-member")!;
    expect(outer.open).toBe(false);
    expect(member.open).toBe(false);
    act(() => {
      outer.querySelector("summary")!.click();
      member.querySelector("summary")!.click();
    });
    expect(outer.open).toBe(true);
    expect(member.open).toBe(true);
    act(() =>
      root.render(
        <AgentSubagentDisclosure
          entries={[{ ...entry, state: "completed", detail: "All checks passed" }]}
        />,
      ),
    );
    expect(outer.open).toBe(true);
    expect(member.open).toBe(true);
    expect(host.textContent).toContain("1 completed");
    expect(host.textContent).toContain("All checks passed");
    expect(host.textContent).not.toContain("tokens");
  });
  it("does not manufacture details and labels incomplete lifecycle summaries", () => {
    act(() =>
      root.render(<AgentSubagentDisclosure entries={[{ ...entry, description: "" }]} truncated />),
    );
    expect(host.textContent).toContain("No additional details reported.");
    expect(host.textContent).toContain("Additional subagents are not included");
    expect(host.querySelector("summary")?.textContent).toContain("At least 1 subagent");
  });
  it("paginates large legacy lists instead of rendering every member", () => {
    const entries = Array.from({ length: 65 }, (_, index) => ({ ...entry, toolId: String(index) }));
    act(() => root.render(<AgentSubagentDisclosure entries={entries} />));
    expect(host.querySelectorAll(".agent-subagent-member")).toHaveLength(32);
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelectorAll(".agent-subagent-member")).toHaveLength(64);
    expect(host.textContent).toContain("1 remaining");
  });
});
