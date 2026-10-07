import { describe, expect, it, vi } from "vitest";
import { AgentMcpServersProjectChoiceStore } from "./agentMcpServersProjectChoice";
import { createAgentMcpServersSurface } from "./agentMcpServersSurface";
import { DeferredAgentMcpServersGateway } from "../test/agentMcpServersTestSupport";

describe("AgentMcpServersProjectChoiceStore", () => {
  it("has no choice until one is made", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    expect(choice.chosen("/work/app")).toBeNull();
    expect(choice.chosen(null)).toBeNull();
  });

  it("answers a choice only for the workspace it was made in", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    choice.choose("/work/app", "/work/api");
    expect(choice.chosen("/work/app")).toBe("/work/api");
    expect(choice.chosen("/work/other")).toBeNull();
    expect(choice.chosen(null)).toBeNull();
  });

  it("retains exactly one choice, replaced by the next one", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    choice.choose("/work/app", "/work/api");
    choice.choose("/work/other", "/work/web");
    expect(choice.chosen("/work/app")).toBeNull();
    expect(choice.chosen("/work/other")).toBe("/work/web");
    choice.choose(null, "/work/api");
    expect(choice.chosen("/work/other")).toBeNull();
    expect(choice.chosen(null)).toBe("/work/api");
  });

  it("notifies on a change, stays silent for a repeat, and stops after unsubscribe", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    const listener = vi.fn();
    const unsubscribe = choice.subscribe(listener);
    choice.choose("/work/app", "/work/api");
    choice.choose("/work/app", "/work/api");
    expect(listener).toHaveBeenCalledTimes(1);
    choice.choose("/work/app", "/work/web");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    choice.choose("/work/app", "/work/api");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("createAgentMcpServersSurface", () => {
  it("builds an idle store and an empty choice without touching the gateway", () => {
    const gateway = new DeferredAgentMcpServersGateway();
    const surface = createAgentMcpServersSurface(gateway);
    const target = { repositoryRoot: "/work/app", provider: "codex" } as const;
    expect(surface.store.state(target)).toEqual({ kind: "idle" });
    expect(surface.projectChoice.chosen("/work/app")).toBeNull();
    expect(gateway.requests()).toEqual([]);
    surface.store.refresh(target);
    expect(gateway.requests()).toEqual([target]);
  });
});
