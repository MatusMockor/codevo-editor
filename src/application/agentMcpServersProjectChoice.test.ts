import { describe, expect, it, vi } from "vitest";
import type { AgentMcpServersProject } from "../domain/agentMcpServersTarget";
import { AgentMcpServersProjectChoiceStore } from "./agentMcpServersProjectChoice";
import { createAgentMcpServersSurface } from "./agentMcpServersSurface";
import { DeferredAgentMcpServersGateway } from "../test/agentMcpServersTestSupport";

const API: AgentMcpServersProject = { kind: "local", repositoryRoot: "/work/api" };
const WEB: AgentMcpServersProject = { kind: "local", repositoryRoot: "/work/web" };
const ON_SERVER: AgentMcpServersProject = {
  kind: "server",
  serverId: "linux",
  runnerId: "runner-home",
  projectId: "api",
};

describe("AgentMcpServersProjectChoiceStore", () => {
  it("has no choice until one is made", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    expect(choice.chosen("/work/app")).toBeNull();
    expect(choice.chosen(null)).toBeNull();
  });

  it("answers a choice only for the workspace it was made in", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    choice.choose("/work/app", API);
    expect(choice.chosen("/work/app")).toEqual(API);
    expect(choice.chosen("/work/other")).toBeNull();
    expect(choice.chosen(null)).toBeNull();
  });

  it("retains exactly one choice, replaced by the next one", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    choice.choose("/work/app", API);
    choice.choose("/work/other", WEB);
    expect(choice.chosen("/work/app")).toBeNull();
    expect(choice.chosen("/work/other")).toEqual(WEB);
    choice.choose(null, API);
    expect(choice.chosen("/work/other")).toBeNull();
    expect(choice.chosen(null)).toEqual(API);
  });

  it("tells a server project from a local one and from the same project on another runner", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    const listener = vi.fn();
    choice.subscribe(listener);
    choice.choose("/work/app", ON_SERVER);
    expect(choice.chosen("/work/app")).toEqual(ON_SERVER);
    choice.choose("/work/app", { ...ON_SERVER });
    expect(listener).toHaveBeenCalledTimes(1);
    choice.choose("/work/app", { ...ON_SERVER, runnerId: "runner-replaced" });
    expect(listener).toHaveBeenCalledTimes(2);
    choice.choose("/work/app", { kind: "local", repositoryRoot: "/linux/runner-home/api" });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(choice.chosen("/work/app")).toEqual({
      kind: "local",
      repositoryRoot: "/linux/runner-home/api",
    });
  });

  it("answers the same frozen value until the choice changes", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    const mutable = { ...ON_SERVER };
    choice.choose(null, mutable);
    Object.assign(mutable, { projectId: "other" });
    expect(choice.chosen(null)).toBe(choice.chosen(null));
    expect(choice.chosen(null)).toEqual(ON_SERVER);
    expect(Object.isFrozen(choice.chosen(null))).toBe(true);
  });

  it("notifies on a change, stays silent for a repeat, and stops after unsubscribe", () => {
    const choice = new AgentMcpServersProjectChoiceStore();
    const listener = vi.fn();
    const unsubscribe = choice.subscribe(listener);
    choice.choose("/work/app", API);
    choice.choose("/work/app", API);
    expect(listener).toHaveBeenCalledTimes(1);
    choice.choose("/work/app", WEB);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    choice.choose("/work/app", API);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("createAgentMcpServersSurface", () => {
  it("builds an idle store and an empty choice without touching the gateway", () => {
    const gateway = new DeferredAgentMcpServersGateway();
    const surface = createAgentMcpServersSurface(gateway);
    const target = { kind: "local", repositoryRoot: "/work/app", provider: "codex" } as const;
    expect(surface.store.state(target)).toEqual({ kind: "idle" });
    expect(surface.projectChoice.chosen("/work/app")).toBeNull();
    expect(surface.serverProjects.state().hosts).toEqual([]);
    expect(gateway.requests()).toEqual([]);
    surface.store.refresh(target);
    expect(gateway.requests()).toEqual([{ repositoryRoot: "/work/app", provider: "codex" }]);
  });
});
