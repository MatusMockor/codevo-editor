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
      }),
    ).toBe(false);
    expect(
      pending?.isEnabled?.({
        hasWorkspace: true,
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
        hasWorkspace: true,
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
