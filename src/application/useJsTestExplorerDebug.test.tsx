// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugLaunchTarget } from "../domain/debug";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import type {
  JsTestExplorerFileNode,
  JsTestExplorerSuiteNode,
  JsTestExplorerTestNode,
} from "../domain/jsTestExplorerTree";
import {
  useJsTestExplorerDebug,
  type UseJsTestExplorerDebugOptions,
  type UseJsTestExplorerDebugResult,
} from "./useJsTestExplorerDebug";

const fileNode: JsTestExplorerFileNode = {
  children: [],
  filePath: "/workspace/packages/api/src/payment.test.ts",
  id: "file",
  kind: "file",
  label: "payment.test.ts",
  status: "idle",
};
const suiteNode: JsTestExplorerSuiteNode = {
  children: [],
  filePath: fileNode.filePath,
  id: "suite",
  kind: "suite",
  label: "card",
  status: "idle",
  suitePath: ["checkout", "card"],
};
const testNode: JsTestExplorerTestNode = {
  filePath: fileNode.filePath,
  id: "test",
  kind: "test",
  label: "handles rows",
  parameterized: true,
  status: "idle",
  suitePath: ["checkout", "card"],
  target: {
    filter: "handles rows",
    kind: "method",
    label: "Run handles rows",
    match: "description",
    position: { column: 3, lineNumber: 12 },
  },
};

describe("useJsTestExplorerDebug", () => {
  let host: HTMLDivElement;
  let root: Root;
  let rootMounted: boolean;
  let latest: UseJsTestExplorerDebugResult;
  let options: UseJsTestExplorerDebugOptions;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    rootMounted = true;
    options = {
      debugStartBlocked: false,
      discoveryGateway: runnerGateway("jest"),
      isDebugStartBlocked: () => false,
      openDebugPanel: vi.fn(),
      rootPath: "/workspace",
      startDebug: vi.fn(async (_launch: DebugLaunchTarget) => undefined),
      workspaceId: "workspace-id",
      workspaceTrusted: true,
    };
  });

  afterEach(() => {
    if (rootMounted) act(() => root.unmount());
    host.remove();
  });

  const render = async (overrides: Partial<UseJsTestExplorerDebugOptions> = {}) => {
    options = { ...options, ...overrides };
    await act(async () => {
      root.render(
        <Harness
          onReady={(value) => {
            latest = value;
          }}
          options={options}
        />,
      );
    });
  };

  it("maps file, suite, and parameterized test nodes to minimal exact launch targets", async () => {
    await render();
    await act(async () => latest.debug(fileNode));
    await act(async () => latest.debug(suiteNode));
    await act(async () => latest.debug(testNode));

    expect(options.startDebug).toHaveBeenNthCalledWith(1, {
      kind: "js-test-selection",
      runner: "jest",
      filePath: fileNode.filePath,
      packageRootPath: "/workspace/packages/api",
      selection: { kind: "file" },
    });
    expect(options.startDebug).toHaveBeenNthCalledWith(2, {
      kind: "js-test-selection",
      runner: "jest",
      filePath: fileNode.filePath,
      packageRootPath: "/workspace/packages/api",
      selection: { kind: "suite", fullName: "checkout card" },
    });
    expect(options.startDebug).toHaveBeenNthCalledWith(3, {
      kind: "js-test-selection",
      runner: "jest",
      filePath: fileNode.filePath,
      packageRootPath: "/workspace/packages/api",
      selection: { kind: "test", fullName: "checkout card handles rows", nameMatch: "prefix" },
    });
    expect(options.openDebugPanel).toHaveBeenCalledTimes(3);
    for (const [launch] of vi.mocked(options.startDebug).mock.calls) {
      expect(launch).not.toHaveProperty("args");
      expect(launch).not.toHaveProperty("env");
      expect(launch).not.toHaveProperty("cwd");
    }
  });

  it("uses the selected-file launch path for Vitest worker inspection", async () => {
    await render({ discoveryGateway: runnerGateway("vitest") });
    await act(async () => latest.debug(fileNode));
    expect(options.startDebug).toHaveBeenCalledExactlyOnceWith({
      kind: "js-test-selection",
      runner: "vitest",
      filePath: fileNode.filePath,
      packageRootPath: "/workspace/packages/api",
      selection: { kind: "file" },
    });
  });

  it("maps synthetic root suites to file selection and top-level tests normally", async () => {
    await render();
    await act(async () =>
      latest.debug({ ...suiteNode, id: "root-suite", label: "(root)", suitePath: [] }),
    );
    await act(async () => latest.debug({ ...testNode, id: "top-level", suitePath: [] }));
    expect(options.startDebug).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ selection: { kind: "file" } }),
    );
    expect(options.startDebug).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        selection: { kind: "test", fullName: "handles rows", nameMatch: "prefix" },
      }),
    );
  });

  it("validates confinement before runner reads and bounds deep ancestor detection", async () => {
    const gateway = runnerGateway("jest");
    await render({ discoveryGateway: gateway });
    await act(async () => latest.debug({ ...testNode, filePath: "/outside/test.ts" }));
    expect(gateway.readTextFileBounded).not.toHaveBeenCalled();
    expect(latest.error).toContain("active workspace");

    const segments = Array.from({ length: 100 }, (_, index) => `d${index}`).join("/");
    const deepFile = `/workspace/${segments}/test.ts`;
    await act(async () => latest.debug({ ...fileNode, filePath: deepFile }));
    expect(gateway.readTextFileBounded).toHaveBeenCalled();
    expect(vi.mocked(gateway.readTextFileBounded).mock.calls.length).toBeLessThan(500);
    expect(options.startDebug).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: deepFile, packageRootPath: "/workspace" }),
    );
  });

  it("guards trust, missing ownership, active sessions, and single-flight starts", async () => {
    await render({ workspaceTrusted: false });
    expect(latest.blocked).toBe(true);
    expect(latest.blockedReason).toContain("Trust this workspace");
    await act(async () => latest.debug(testNode));
    await render({ workspaceTrusted: true, workspaceId: null });
    expect(latest.blocked).toBe(true);
    await act(async () => latest.debug(testNode));
    await render({ workspaceId: "workspace-id", debugStartBlocked: true });
    await act(async () => latest.debug(testNode));
    expect(options.startDebug).not.toHaveBeenCalled();
    expect(latest.unavailable).toContain("active debug session");

    const deferred = deferredRead();
    await render({
      debugStartBlocked: false,
      discoveryGateway: deferred.gateway,
    });
    let first!: Promise<void>;
    await act(async () => {
      first = latest.debug(testNode);
      void latest.debug(testNode);
    });
    expect(latest.isDebugging).toBe(true);
    deferred.resolve({ status: "tooLarge" });
    await act(async () => first);
    expect(latest.unavailable).toContain("no Jest or Vitest runner");
    expect(options.startDebug).not.toHaveBeenCalled();
  });

  it("drops runner detection when workspace ownership changes without opening Debug", async () => {
    const deferred = deferredRead();
    await render({ discoveryGateway: deferred.gateway });
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.debug(suiteNode);
    });
    await render({ rootPath: "/other", workspaceId: "other-id" });
    deferred.resolve({ status: "ok", content: JSON.stringify({ devDependencies: { jest: "1" } }) });
    await act(async () => pending);
    expect(options.openDebugPanel).not.toHaveBeenCalled();
    expect(options.startDebug).not.toHaveBeenCalled();
    expect(latest.isDebugging).toBe(false);
  });

  it("invalidates deferred detection on unmount without opening or starting Debug", async () => {
    const deferred = deferredRead();
    await render({ discoveryGateway: deferred.gateway });
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.debug(suiteNode);
    });
    act(() => root.unmount());
    rootMounted = false;
    deferred.resolve({ status: "ok", content: "export default {}" });
    await pending;
    expect(options.openDebugPanel).not.toHaveBeenCalled();
    expect(options.startDebug).not.toHaveBeenCalled();
  });

  it("reports an explicit unavailable runner and bounds visible launch errors", async () => {
    await render({ discoveryGateway: runnerGateway(null) });
    await act(async () => latest.debug(testNode));
    expect(latest.unavailable).toContain("no Jest or Vitest runner");
    expect(options.openDebugPanel).not.toHaveBeenCalled();

    await render({
      discoveryGateway: runnerGateway("vitest"),
      startDebug: vi.fn(async () => {
        throw new Error("é".repeat(5_000));
      }),
    });
    await act(async () => latest.debug(testNode));
    expect(new TextEncoder().encode(latest.error ?? "").byteLength).toBeLessThanOrEqual(4_096);
    expect(latest.error).toMatch(/…$/);
  });
});

function Harness({
  onReady,
  options,
}: {
  readonly onReady: (value: UseJsTestExplorerDebugResult) => void;
  readonly options: UseJsTestExplorerDebugOptions;
}) {
  const value = useJsTestExplorerDebug(options);
  onReady(value);
  return null;
}

function runnerGateway(runner: "jest" | "vitest" | null): WorkspaceTestDiscoveryGateway {
  return {
    enumerateJsTestFiles: vi.fn(async () => ({ files: [], truncated: false, visited: 0 })),
    readTextFileBounded: vi.fn(async (_root, relativePath) => {
      if (!runner) return { status: "tooLarge" as const };
      if (relativePath === "packages/api/package.json") {
        return {
          status: "ok" as const,
          content: JSON.stringify({ devDependencies: { [runner]: "1" } }),
        };
      }
      if (relativePath === "package.json") {
        return {
          status: "ok" as const,
          content: JSON.stringify({ devDependencies: { [runner]: "1" } }),
        };
      }
      if (relativePath === `packages/api/node_modules/.bin/${runner}`) {
        return { status: "ok" as const, content: "binary" };
      }
      if (relativePath === `node_modules/.bin/${runner}`) {
        return { status: "ok" as const, content: "binary" };
      }
      if (runner === "vitest" && relativePath === "packages/api/vitest.config.ts") {
        return { status: "ok" as const, content: "export default {}" };
      }
      if (runner === "vitest" && relativePath === "vitest.config.ts") {
        return { status: "ok" as const, content: "export default {}" };
      }
      return { status: "tooLarge" as const };
    }),
  };
}

function deferredRead() {
  let resolve!: (value: { status: "tooLarge" } | { status: "ok"; content: string }) => void;
  const pending = new Promise<{ status: "tooLarge" } | { status: "ok"; content: string }>(
    (settle) => {
      resolve = settle;
    },
  );
  return {
    gateway: {
      enumerateJsTestFiles: vi.fn(async () => ({ files: [], truncated: false, visited: 0 })),
      readTextFileBounded: vi.fn(async () => pending),
    } satisfies WorkspaceTestDiscoveryGateway,
    resolve,
  };
}
