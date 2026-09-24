import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../commandRegistry";
import type { PaletteBranchSource } from "./commandPaletteProvider";
import {
  editorPaletteIntentPorts,
  type EditorPaletteIntentDependencies,
} from "./editorPaletteIntentPorts";

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: false,
  activeDocumentDirty: false,
};

function dependencies(
  overrides: Partial<EditorPaletteIntentDependencies> = {},
): EditorPaletteIntentDependencies {
  return {
    commands: { get: () => undefined },
    context,
    workspaceTabs: ["/u/orders-api"],
    branchSource: null,
    activateWorkspaceTab: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("editorPaletteIntentPorts", () => {
  it("never reopens a workspace that is no longer an open tab", async () => {
    const activateWorkspaceTab = vi.fn(async () => undefined);
    const ports = editorPaletteIntentPorts(dependencies({ activateWorkspaceTab }));

    expect(await ports.switchEditorProject("/u/closed")).toBe(false);
    expect(activateWorkspaceTab).not.toHaveBeenCalled();
    expect(await ports.switchEditorProject("/u/orders-api")).toBe(true);
    expect(activateWorkspaceTab).toHaveBeenCalledWith("/u/orders-api");
  });

  it("fails a branch switch without a branch source", async () => {
    expect(await editorPaletteIntentPorts(dependencies()).switchBranch("main", false)).toBe(false);

    const switchTo = vi.fn(async () => undefined);
    const branchSource: PaletteBranchSource = {
      scopeKey: "/u/orders-api",
      scopeLabel: "orders-api",
      load: async () => [],
      switchTo,
    };
    expect(
      await editorPaletteIntentPorts(dependencies({ branchSource })).switchBranch("feat", true),
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
    const ports = editorPaletteIntentPorts(
      dependencies({ commands: { get: (id) => byId.get(id) } }),
    );

    expect(await ports.runEditorScript("k")).toBe("executed");
    expect(await ports.runEditorScript("off")).toBe("disabled");
    expect(await ports.runEditorScript("gone")).toBe("missing");
    await expect(ports.runEditorScript("bad")).rejects.toThrow("boom");
  });
});
