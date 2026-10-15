import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../commandRegistry";
import type { PaletteBranchSource } from "./commandPaletteProvider";
import {
  agentPaletteIntentPorts,
  type AgentPaletteIntentDependencies,
} from "./agentPaletteIntentPorts";

const context: CommandContext = {
  hasWorkspace: true,
};

function dependencies(
  overrides: Partial<AgentPaletteIntentDependencies> = {},
): AgentPaletteIntentDependencies {
  return {
    commands: { get: () => undefined },
    context,
    workspaceTabs: ["/u/orders-api"],
    branchSource: null,
    activateWorkspaceTab: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("agentPaletteIntentPorts", () => {
  it("never reopens a workspace that is no longer an open tab", async () => {
    const activateWorkspaceTab = vi.fn(async () => undefined);
    const ports = agentPaletteIntentPorts(dependencies({ activateWorkspaceTab }));

    expect(await ports.switchWorkspaceProject("/u/closed")).toBe(false);
    expect(activateWorkspaceTab).not.toHaveBeenCalled();
    expect(await ports.switchWorkspaceProject("/u/orders-api")).toBe(true);
    expect(activateWorkspaceTab).toHaveBeenCalledWith("/u/orders-api");
  });

  it("fails a branch switch without a branch source", async () => {
    expect(await agentPaletteIntentPorts(dependencies()).switchBranch("main", false)).toBe(false);

    const switchTo = vi.fn(async () => undefined);
    const branchSource: PaletteBranchSource = {
      scopeKey: "/u/orders-api",
      scopeLabel: "orders-api",
      load: async () => [],
      switchTo,
    };
    expect(
      await agentPaletteIntentPorts(dependencies({ branchSource })).switchBranch("feat", true),
    ).toBe(true);
    expect(switchTo).toHaveBeenCalledWith({ name: "feat", remote: true, current: false });
  });

  it("awaits a script command, reports disabled/missing and propagates rejections", async () => {
    const script: Command = {
      id: "script.node.k",
      title: "test",
      category: "Scripts",
      isEnabled: () => true,
      run: vi.fn(async () => undefined),
    };
    const disabled: Command = { ...script, id: "script.node.off", isEnabled: () => false };
    const failing: Command = {
      ...script,
      id: "script.node.bad",
      run: () => Promise.reject(new Error("boom")),
    };
    const byId = new Map([script, disabled, failing].map((command) => [command.id, command]));
    const ports = agentPaletteIntentPorts(
      dependencies({ commands: { get: (id) => byId.get(id) } }),
    );

    expect(await ports.runWorkspaceScript("k")).toBe("executed");
    expect(await ports.runWorkspaceScript("off")).toBe("disabled");
    expect(await ports.runWorkspaceScript("gone")).toBe("missing");
    await expect(ports.runWorkspaceScript("bad")).rejects.toThrow("boom");
  });
});
