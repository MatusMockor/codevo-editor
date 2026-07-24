// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunTarget } from "../domain/nodeRunTask";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";
import {
  useNodeRunConfigurationLauncher,
  type NodeRunConfigurationLauncher,
  type UseNodeRunConfigurationLauncherOptions,
} from "./useNodeRunConfigurationLauncher";

const ROOT = "/workspace";
const WORKSPACE_ID = "workspace-a";

describe("useNodeRunConfigurationLauncher", () => {
  let host: HTMLDivElement;
  let reactRoot: ReturnType<typeof createRoot>;
  let current: NodeRunConfigurationLauncher;
  let options: UseNodeRunConfigurationLauncherOptions;
  let startTarget: ReturnType<typeof vi.fn<(target: NodeRunTarget) => boolean>>;

  function Harness() {
    current = useNodeRunConfigurationLauncher(options);
    return null;
  }

  function render() {
    act(() => reactRoot.render(<Harness />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    reactRoot = createRoot(host);
    startTarget = vi.fn(() => true);
    options = {
      blocked: false,
      isBlocked: () => false,
      isWorkspaceCurrent: (rootPath, workspaceId) =>
        rootPath === ROOT && workspaceId === WORKSPACE_ID,
      isWorkspaceTrusted: () => true,
      revealPicker: vi.fn(),
      rootPath: ROOT,
      startTarget,
      workspaceId: WORKSPACE_ID,
      workspaceReads: readsFor([
        { name: "Attach", default: true, target: { kind: "attach", port: 9229 } },
        {
          name: "API",
          target: { kind: "script", path: "src/api.ts" },
          args: ["--token", "private-argument"],
          env: { API_TOKEN: "private-environment" },
        },
      ]),
      workspaceTrusted: true,
    };
    render();
  });

  afterEach(() => {
    act(() => reactRoot.unmount());
  });

  it("publishes safe runnable metadata while retaining target secrets privately", async () => {
    await act(async () => current.load());

    expect(current.choices).toEqual([
      { default: false, name: "API", runnable: true, targetKind: "script" },
    ]);
    expect(current.selectedName).toBe("API");
    expect(JSON.stringify(current)).not.toContain("private-argument");
    expect(JSON.stringify(current)).not.toContain("private-environment");

    await act(async () => expect(await current.startSelected()).toBe(true));
    expect(startTarget).toHaveBeenCalledWith({
      args: ["--token", "private-argument"],
      env: { API_TOKEN: "private-environment" },
      kind: "node-configured-script",
      scriptPath: "/workspace/src/api.ts",
    });
  });

  it("keeps the picker open when the lifecycle rejects and closes only after acceptance", async () => {
    startTarget.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => current.load());
    act(() => current.openPicker());

    await act(async () => expect(await current.startNamed("API")).toBe(false));
    expect(current.pickerOpen).toBe(true);

    await act(async () => expect(await current.startNamed("API")).toBe(true));
    expect(current.pickerOpen).toBe(false);
  });

  it("refuses unsupported names without passing private data to the lifecycle", async () => {
    await act(async () => current.load());
    act(() => current.openPicker());

    await act(async () => expect(await current.startNamed("Attach")).toBe(false));

    expect(startTarget).not.toHaveBeenCalled();
    expect(current.pickerOpen).toBe(true);
  });

  it("normalizes an attach-only private configuration collection to empty", async () => {
    options = {
      ...options,
      workspaceReads: readsFor([
        { name: "Attach", default: true, target: { kind: "attach", port: 9229 } },
      ]),
    };
    render();

    await act(async () => current.load());

    expect(current.choices).toEqual([]);
    expect(current.selectedName).toBeNull();
    expect(current.state).toEqual({ kind: "empty" });
    await act(async () => expect(await current.startNamed("Attach")).toBe(false));
    expect(startTarget).not.toHaveBeenCalled();
  });

  it("invalidates loaded private targets on a root, trust, read-port, or blocked switch", async () => {
    const transitions: Partial<UseNodeRunConfigurationLauncherOptions>[] = [
      { rootPath: "/replacement", workspaceId: "workspace-b" },
      { workspaceTrusted: false },
      { workspaceReads: readsFor([]) },
      { blocked: true },
    ];
    for (const transition of transitions) {
      await act(async () => current.load());
      act(() => current.openPicker());
      options = { ...options, ...transition };
      render();

      expect(current.pickerOpen).toBe(false);
      await act(async () => expect(await current.startNamed("API")).toBe(false));
      expect(startTarget).not.toHaveBeenCalled();

      options = {
        ...options,
        blocked: false,
        rootPath: ROOT,
        workspaceId: WORKSPACE_ID,
        workspaceReads: readsFor([{ name: "API", target: { kind: "script", path: "src/api.ts" } }]),
        workspaceTrusted: true,
      };
      render();
    }
  });

  it("rechecks dynamic trust and runtime blocking immediately before start", async () => {
    let trustedNow = true;
    let blockedNow = false;
    options = {
      ...options,
      isBlocked: () => blockedNow,
      isWorkspaceTrusted: () => trustedNow,
    };
    render();
    await act(async () => current.load());

    trustedNow = false;
    await act(async () => expect(await current.startNamed("API")).toBe(false));
    trustedNow = true;
    blockedNow = true;
    await act(async () => expect(await current.startNamed("API")).toBe(false));

    expect(startTarget).not.toHaveBeenCalled();
  });

  it("reports acceptance and closes when the accepted lifecycle immediately becomes blocked", async () => {
    let integrated!: NodeRunConfigurationLauncher;
    const acceptedTarget = vi.fn((_target: NodeRunTarget) => true);
    const stableReads = readsFor([{ name: "API", target: { kind: "script", path: "src/api.ts" } }]);
    function BlockingHarness() {
      const [blocked, setBlocked] = useState(false);
      const accept = useCallback((target: NodeRunTarget) => {
        acceptedTarget(target);
        setBlocked(true);
        return true;
      }, []);
      integrated = useNodeRunConfigurationLauncher({
        blocked,
        isBlocked: () => blocked,
        isWorkspaceCurrent: () => true,
        isWorkspaceTrusted: () => true,
        revealPicker: () => undefined,
        rootPath: ROOT,
        startTarget: accept,
        workspaceId: WORKSPACE_ID,
        workspaceReads: stableReads,
        workspaceTrusted: true,
      });
      return null;
    }
    act(() => reactRoot.render(<BlockingHarness />));
    await act(async () => integrated.load());
    act(() => integrated.openPicker());

    await act(async () => expect(await integrated.startSelected()).toBe(true));

    expect(acceptedTarget).toHaveBeenCalledOnce();
    expect(integrated.pickerOpen).toBe(false);
  });
});

function readsFor(
  configurations: readonly Record<string, unknown>[],
): NodeLaunchConfigurationReads {
  const source = JSON.stringify({ version: 1, configurations });
  return {
    readDirectory: vi.fn(async (path) =>
      path === ROOT
        ? [{ kind: "directory" as const, name: ".codevo", path: `${ROOT}/.codevo` }]
        : [
            {
              kind: "file" as const,
              name: "launch.json",
              path: `${ROOT}/.codevo/launch.json`,
            },
          ],
    ),
    readFile: vi.fn(async () => source),
  };
}
