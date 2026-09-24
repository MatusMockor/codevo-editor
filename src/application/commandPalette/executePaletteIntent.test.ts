import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../commandRegistry";
import { executePaletteIntent, type PaletteIntentPorts } from "./executePaletteIntent";

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: false,
  activeDocumentDirty: false,
};

function ports(overrides: Partial<PaletteIntentPorts> = {}): PaletteIntentPorts {
  return {
    commands: { get: () => undefined },
    context,
    agent: null,
    models: null,
    openFile: vi.fn(async () => undefined),
    switchEditorProject: vi.fn(async () => true),
    runEditorScript: vi.fn(async () => "executed" as const),
    switchBranch: vi.fn(async () => true),
    setPalette: vi.fn(async () => undefined),
    setColorScheme: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("executePaletteIntent", () => {
  it("closes after an executed command and stays on a disabled one", async () => {
    const run = vi.fn();
    const enabled: Command = { id: "a", title: "A", category: "X", isEnabled: () => true, run };
    const disabled: Command = { ...enabled, id: "b", isEnabled: () => false };
    const lookup = {
      get: (id: string) => (id === "a" ? enabled : id === "b" ? disabled : undefined),
    };

    expect(
      await executePaletteIntent({ kind: "command", commandId: "a" }, ports({ commands: lookup })),
    ).toBe("close");
    expect(
      await executePaletteIntent({ kind: "command", commandId: "b" }, ports({ commands: lookup })),
    ).toBe("stay");
    expect(
      await executePaletteIntent(
        { kind: "command", commandId: "zzz" },
        ports({ commands: lookup }),
      ),
    ).toBe("failed");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an agent target disappeared", async () => {
    const agent = {
      projects: [],
      threads: [],
      scripts: [],
      scriptsTruncated: false,
      activeProjectKey: null,
      openThread: vi.fn(() => false),
      switchProject: vi.fn(() => false),
      newThreadIn: vi.fn(() => false),
      runScript: vi.fn(() => false),
    };
    expect(
      await executePaletteIntent({ kind: "openThread", threadId: "gone" }, ports({ agent })),
    ).toBe("failed");
    expect(
      await executePaletteIntent({ kind: "runScript", scriptKey: "gone" }, ports({ agent })),
    ).toBe("failed");
    expect(await executePaletteIntent({ kind: "selectModel", modelKey: "m" }, ports())).toBe(
      "failed",
    );
  });

  it("routes editor scripts and projects when no agent provider exists", async () => {
    const runEditorScript = vi.fn(async () => "executed" as const);
    const switchEditorProject = vi.fn(async () => true);
    const all = ports({ runEditorScript, switchEditorProject });

    expect(await executePaletteIntent({ kind: "runScript", scriptKey: "k" }, all)).toBe("close");
    expect(await executePaletteIntent({ kind: "switchProject", projectKey: "/p" }, all)).toBe(
      "close",
    );
    expect(runEditorScript).toHaveBeenCalledWith("k");
    expect(switchEditorProject).toHaveBeenCalledWith("/p");
  });

  it("fails closed when an editor project, script or branch target is gone", async () => {
    const gone = ports({
      switchEditorProject: vi.fn(async () => false),
      runEditorScript: vi.fn(async () => "missing" as const),
      switchBranch: vi.fn(async () => false),
    });

    expect(await executePaletteIntent({ kind: "switchProject", projectKey: "/gone" }, gone)).toBe(
      "failed",
    );
    expect(await executePaletteIntent({ kind: "runScript", scriptKey: "gone" }, gone)).toBe(
      "failed",
    );
    expect(
      await executePaletteIntent({ kind: "switchBranch", name: "main", remote: false }, gone),
    ).toBe("failed");
  });

  it("propagates a rejected editor script so the caller can report it", async () => {
    const failing = ports({
      runEditorScript: vi.fn(async () => Promise.reject(new Error("boom"))),
    });

    await expect(
      executePaletteIntent({ kind: "runScript", scriptKey: "k" }, failing),
    ).rejects.toThrow("boom");
  });

  it("does nothing for notice rows and page intents", async () => {
    expect(await executePaletteIntent({ kind: "none" }, ports())).toBe("stay");
    expect(await executePaletteIntent({ kind: "page", page: "theme" }, ports())).toBe("stay");
  });
});
