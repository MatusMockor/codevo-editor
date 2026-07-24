import { describe, expect, it, vi } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import { workbenchNodePackageScriptCommands } from "./workbenchNodePackageScriptCommands";

describe("workbenchNodePackageScriptCommands", () => {
  it("uses manifest-qualified collision-free ids and informative monorepo titles", () => {
    const commands = workbenchNodePackageScriptCommands({
      enabled: true,
      pending: false,
      scripts: [
        script("package.json", "build", "root"),
        script("apps/web/package.json", "build", "web"),
      ],
      run: vi.fn(),
      stop: vi.fn(),
    });

    expect(commands.map(({ id, title }) => ({ id, title }))).toEqual([
      {
        id: "npm.runSelectedScript",
        title: "Run Script",
      },
      {
        id: "script.node.node-package-script:package.json:build",
        title: "pnpm: build (root · package.json)",
      },
      {
        id: "script.node.node-package-script:apps%2Fweb%2Fpackage.json:build",
        title: "pnpm: build (web · apps/web/package.json)",
      },
      {
        id: "script.node.stopCurrent",
        title: "Stop Current Package Script",
      },
    ]);
  });

  it("keeps the official editor-context command hidden and delegates a live dirty capture", () => {
    const runSelectedScript = vi.fn(() => true);
    const commands = workbenchNodePackageScriptCommands({
      enabled: true,
      pending: false,
      run: vi.fn(),
      runSelectedScript,
      scripts: [],
      stop: vi.fn(),
    });
    const command = commands.find(({ id }) => id === "npm.runSelectedScript");
    const capture = {
      anchorOffset: 7,
      content: '{"scripts":{"dev":"vite"}}',
      documentPath: "/workspace/package.json",
      modelIdentity: {},
      modelVersion: 3,
    };
    const context = {
      activeDocumentDirty: true,
      hasActiveDocument: true,
      hasWorkspace: true,
      npmRunSelectedScriptCapture: capture,
    };

    expect(command).toMatchObject({
      category: "NPM",
      title: "Run Script",
      visibleInCommandPalette: false,
    });
    expect(command?.isEnabled(context)).toBe(true);
    command?.run(context);
    expect(runSelectedScript).toHaveBeenCalledWith(capture);
  });

  it("disables the contextual command without an eligible capture/capability", () => {
    const commandFor = (enabled: boolean, pending: boolean, withRunner = true) =>
      workbenchNodePackageScriptCommands({
        enabled,
        pending,
        run: vi.fn(),
        ...(withRunner ? { runSelectedScript: vi.fn(() => true) } : {}),
        scripts: [],
        stop: vi.fn(),
      }).find(({ id }) => id === "npm.runSelectedScript")!;
    const context = {
      activeDocumentDirty: false,
      hasActiveDocument: true,
      hasWorkspace: true,
      npmRunSelectedScriptCapture: {
        anchorOffset: 0,
        content: "{}",
        documentPath: "/workspace/package.json",
        modelIdentity: {},
        modelVersion: 1,
      },
    };

    expect(commandFor(false, false).isEnabled(context)).toBe(false);
    expect(commandFor(true, true).isEnabled(context)).toBe(false);
    expect(commandFor(true, false, false).isEnabled(context)).toBe(false);
    expect(
      commandFor(true, false).isEnabled({ ...context, npmRunSelectedScriptCapture: undefined }),
    ).toBe(false);
  });

  it("disables execution while untrusted or pending and delegates only the typed identity", () => {
    const run = vi.fn();
    const stop = vi.fn();
    const value = script("package.json", "build", null);
    const disabled = workbenchNodePackageScriptCommands({
      enabled: false,
      pending: false,
      scripts: [value],
      run,
      stop,
    }).find(({ id }) => id.startsWith("script.node.node-package-script"));
    const pending = workbenchNodePackageScriptCommands({
      enabled: true,
      pending: true,
      scripts: [value],
      run,
      stop: vi.fn(),
    }).find(({ id }) => id.startsWith("script.node.node-package-script"));
    expect(
      disabled?.isEnabled?.({
        hasWorkspace: true,
        hasActiveDocument: false,
        activeDocumentDirty: false,
      }),
    ).toBe(false);
    expect(
      pending?.isEnabled?.({
        hasWorkspace: true,
        hasActiveDocument: false,
        activeDocumentDirty: false,
      }),
    ).toBe(false);

    pending?.run();
    expect(run).toHaveBeenCalledWith(value);
    const commands = workbenchNodePackageScriptCommands({
      enabled: true,
      pending: true,
      scripts: [value],
      run,
      stop,
    });
    const stopCommand = commands[commands.length - 1];
    expect(stopCommand?.id).toBe("script.node.stopCurrent");
    expect(
      stopCommand?.isEnabled?.({
        activeDocumentDirty: false,
        hasWorkspace: true,
        hasActiveDocument: false,
      }),
    ).toBe(true);
    stopCommand?.run();
    expect(stop).toHaveBeenCalledOnce();
  });
});

function script(
  manifestRelativePath: string,
  scriptName: string,
  packageName: string | null,
): NodePackageScript {
  return {
    key: `node-package-script:${encodeURIComponent(manifestRelativePath)}:${encodeURIComponent(scriptName)}`,
    manifestRelativePath,
    packageName,
    packageManager: "pnpm",
    packageRootRelativePath: manifestRelativePath === "package.json" ? "" : "apps/web",
    scriptName,
  };
}
