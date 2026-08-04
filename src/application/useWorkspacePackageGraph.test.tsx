// @vitest-environment jsdom

import { act, Suspense, startTransition, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceSourceDiscoveryGateway,
} from "../domain/workspaceSourceDiscovery";
import { waitForReact } from "../test/reactTestLifecycle";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { useWorkbenchWorkspacePackageGraph } from "./useWorkbenchWorkspacePackageGraph";
import {
  useWorkspacePackageGraph,
  PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS,
  WORKSPACE_PACKAGE_DISCOVERY_DEADLINE_MS,
  WORKSPACE_PACKAGE_DISCOVERY_LIMITS,
  type WorkspacePackageDiscovery,
} from "./useWorkspacePackageGraph";
import type { WorkspacePackageProcessingRuntime } from "./workspacePackageGraphProcessing";

const IMMEDIATE_PROCESSING_RUNTIME: WorkspacePackageProcessingRuntime = {
  now: () => 0,
  yieldToMainThread: () => Promise.resolve(),
};

describe("useWorkspacePackageGraph", () => {
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

  it("discovers workspace packages from manifests without enumerating or reading source files", async () => {
    const gateway = packageGateway();
    const harness = renderDiscovery(root, gateway);

    await waitForReact(() => expect(harness.current().authority).toBe("complete"));

    expect(gateway.enumeratePackageJsonFiles).toHaveBeenCalledExactlyOnceWith(
      "/workspace",
      WORKSPACE_PACKAGE_DISCOVERY_LIMITS,
    );
    expect(gateway.enumerateJavaScriptSourceFiles).not.toHaveBeenCalled();
    expect(gateway.readSourceTextBounded).toHaveBeenCalledTimes(3);
    expect(harness.current().packages).toEqual([
      {
        name: "@repo/api",
        relativeDirPath: "packages/api",
        status: "unresolved",
      },
    ]);
    expect(harness.current().packageForPath("/workspace/packages/api/src/index.ts")).toEqual({
      kind: "package",
      name: "@repo/api",
      relativeDirPath: "packages/api",
    });
  });

  it("mounts package discovery once for shared workbench consumers", async () => {
    const gateway = packageGateway();
    let expressConsumer: WorkspacePackageDiscovery | undefined;
    let handleWorkspaceFileChange:
      | ReturnType<typeof useWorkbenchWorkspacePackageGraph>["handleWorkspaceDiscoveryFileChange"]
      | undefined;
    let packageForPath: WorkspacePackageDiscovery["packageForPath"] | undefined;
    let problemsConsumer: WorkspacePackageDiscovery | undefined;

    function Harness() {
      const controller = useWorkbenchWorkspacePackageGraph(
        {
          javaScriptTypeScript: {
            frameworks: [],
            hasJsconfig: false,
            hasPackageJson: true,
            hasTsconfig: true,
            packageManager: "npm",
            packageName: "root",
            packages: [],
            typeScriptDependencyVersion: null,
            usesTypeScript: true,
            workspaceTypeScriptVersion: null,
          },
          php: null,
          rootPath: "/workspace",
        },
        false,
        gateway,
        createWorkspaceRuntimeOwner("workspace", "/workspace"),
        IMMEDIATE_PROCESSING_RUNTIME,
      );
      expressConsumer = controller.workspacePackageDiscovery;
      handleWorkspaceFileChange = controller.handleWorkspaceDiscoveryFileChange;
      packageForPath = controller.packageForPath;
      problemsConsumer = controller.workspacePackageDiscovery;
      return null;
    }

    act(() => root.render(<Harness />));
    await waitForReact(() => expect(expressConsumer?.authority).toBe("complete"));

    expect(expressConsumer).toBe(problemsConsumer);
    expect(packageForPath?.("/workspace/packages/api/src/index.ts")).toEqual({
      kind: "package",
      name: "@repo/api",
      relativeDirPath: "packages/api",
    });
    expect(gateway.enumeratePackageJsonFiles).toHaveBeenCalledTimes(1);

    act(() =>
      handleWorkspaceFileChange?.({
        fileKind: "file",
        kind: "modified",
        path: "/workspace/packages/api/src/index.ts",
        previousPath: null,
        previousRelativePath: null,
        relativePath: "packages/api/src/index.ts",
        rootPath: "/workspace",
      }),
    );
    await act(async () => {
      await new Promise((resolve) =>
        window.setTimeout(resolve, PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS + 10),
      );
    });
    expect(gateway.enumeratePackageJsonFiles).toHaveBeenCalledTimes(1);

    act(() =>
      handleWorkspaceFileChange?.({
        fileKind: "file",
        kind: "modified",
        path: "/workspace/packages/api/package.json",
        previousPath: null,
        previousRelativePath: null,
        relativePath: "packages/api/package.json",
        rootPath: "/workspace",
      }),
    );
    expect(expressConsumer?.authority).toBe("loading");
    expect(packageForPath?.("/workspace/packages/api/src/index.ts")).toEqual({
      kind: "loading",
    });
    await act(async () => {
      await new Promise((resolve) =>
        window.setTimeout(resolve, PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS + 10),
      );
    });
    expect(gateway.enumeratePackageJsonFiles).toHaveBeenCalledTimes(2);
    expect(expressConsumer?.authority).toBe("complete");
  });

  it("publishes loading authority before the first owned discovery settles", () => {
    const harness = renderDiscovery(root, packageGateway());

    expect(harness.current()).toEqual(
      expect.objectContaining({
        authority: "loading",
        loaded: false,
        ownerKey: "workspace\u0000/workspace",
      }),
    );
  });

  it("publishes bounded authority instead of an empty complete graph when enumeration truncates", async () => {
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockResolvedValue({
      files: ["package.json"],
      truncated: true,
      visited: 200_001,
    });
    const harness = renderDiscovery(root, gateway);

    await waitForReact(() => expect(harness.current().loaded).toBe(true));

    expect(harness.current()).toEqual(
      expect.objectContaining({
        authority: "bounded",
        packages: [],
      }),
    );
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalled();
  });

  it("fails closed and rejects a stale package result across an A to B to A owner switch", async () => {
    let releaseFirstA: (value: {
      files: readonly string[];
      truncated: boolean;
      visited: number;
    }) => void = () => undefined;
    const firstA = new Promise<{
      files: readonly string[];
      truncated: boolean;
      visited: number;
    }>((resolve) => {
      releaseFirstA = resolve;
    });
    let aCalls = 0;
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockImplementation(async (rootPath) => {
      if (rootPath === "/a" && aCalls === 0) {
        aCalls += 1;
        return firstA;
      }
      const packageName = rootPath === "/a" ? "a" : "b";
      return {
        files: ["package.json", `packages/${packageName}/package.json`],
        truncated: false,
        visited: 4,
      };
    });
    vi.mocked(gateway.readSourceTextBounded).mockImplementation(async (rootPath, path) => {
      if (path === "pnpm-workspace.yaml") return { status: "notFound" };
      if (path === "package.json") {
        return {
          status: "ok",
          content: '{"name":"root","workspaces":["packages/*"]}',
        };
      }
      return {
        status: "ok",
        content: `{"name":"@repo/${rootPath === "/a" ? "a" : "b"}"}`,
      };
    });
    const harness = renderDiscovery(root, gateway, "/a", "a");

    expect(harness.current()).toEqual(
      expect.objectContaining({
        authority: "loading",
        ownerKey: "a\u0000/a",
      }),
    );
    expect(harness.current().packageForPath("/a/packages/a/src/index.ts")).toEqual({
      kind: "loading",
    });

    harness.set("/b", "b");
    expect(harness.current()).toEqual(
      expect.objectContaining({
        authority: "loading",
        ownerKey: "b\u0000/b",
      }),
    );
    expect(harness.current().packageForPath("/b/packages/b/src/index.ts")).toEqual({
      kind: "loading",
    });
    await waitForReact(() => expect(harness.current().packages[0]?.name).toBe("@repo/b"));

    harness.set("/a", "a");
    expect(harness.current()).toEqual(
      expect.objectContaining({
        authority: "loading",
        ownerKey: "a\u0000/a",
      }),
    );
    expect(harness.current().packageForPath("/a/packages/a/src/index.ts")).toEqual({
      kind: "loading",
    });
    await waitForReact(() => expect(harness.current().packages[0]?.name).toBe("@repo/a"));

    await act(async () => {
      releaseFirstA({
        files: ["package.json", "packages/stale/package.json"],
        truncated: false,
        visited: 4,
      });
      await firstA;
    });

    expect(harness.current().packages).toEqual([
      {
        name: "@repo/a",
        relativeDirPath: "packages/a",
        status: "unresolved",
      },
    ]);
    expect(harness.current().packageForPath("/a/packages/a/src/index.ts")).toEqual({
      kind: "package",
      name: "@repo/a",
      relativeDirPath: "packages/a",
    });
    expect(harness.current().packageForPath("/a/packages/stale/src/index.ts")).toEqual({
      kind: "package",
      name: "root",
      relativeDirPath: "",
    });
  });

  it("observes both concurrent discovery branches when an owner switch cancels them", async () => {
    const pendingReads = new Map<string, (value: BoundedWorkspaceSourceRead) => void>();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockImplementation(async (rootPath) => ({
      files: ["package.json"],
      truncated: false,
      visited: rootPath === "/a" ? 1 : 2,
    }));
    vi.mocked(gateway.readSourceTextBounded).mockImplementation((rootPath, relativePath) => {
      if (rootPath === "/b") {
        return Promise.resolve(
          relativePath === "package.json"
            ? { status: "ok", content: '{"name":"b"}' }
            : { status: "notFound" },
        );
      }

      return new Promise<BoundedWorkspaceSourceRead>((resolve) => {
        pendingReads.set(relativePath, resolve);
      });
    });
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const harness = renderDiscovery(root, gateway, "/a", "a");
      await waitForReact(() => {
        expect([...pendingReads.keys()].sort()).toEqual(["package.json", "pnpm-workspace.yaml"]);
      });

      harness.set("/b", "b");
      await waitForReact(() => expect(harness.current().ownerKey).toBe("b\u0000/b"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(unhandledRejections).toEqual([]);
      await waitForReact(() => expect(harness.current().rootPackageJson).toEqual({ name: "b" }));
      expect(harness.current().packages).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      pendingReads.get("package.json")?.({ status: "ok", content: '{"name":"stale-a"}' });
      pendingReads.get("pnpm-workspace.yaml")?.({ status: "notFound" });
      await Promise.resolve();
    }
  });

  it("does not let a discarded concurrent owner render invalidate committed discovery", async () => {
    let releaseEnumeration: () => void = () => undefined;
    const enumeration = new Promise<void>((resolve) => {
      releaseEnumeration = resolve;
    });
    const suspended = new Promise<never>(() => undefined);
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockImplementation(async () => {
      await enumeration;
      return {
        files: ["package.json", "packages/api/package.json"],
        truncated: false,
        visited: 4,
      };
    });
    let committed = {} as WorkspacePackageDiscovery;
    let renderSuspendedOwner = 0;
    let switchOwner: () => void = () => undefined;

    function Discovery({ owner }: { owner: "a" | "b" }) {
      const discovery = useWorkspacePackageGraph({
        discoveryVersion: 0,
        enabled: true,
        gateway,
        processingRuntime: IMMEDIATE_PROCESSING_RUNTIME,
        rootPath: owner === "a" ? "/workspace" : "/discarded",
        workspaceId: owner,
      });
      useLayoutEffect(() => {
        committed = discovery;
      }, [discovery]);
      if (owner === "b") {
        renderSuspendedOwner += 1;
        throw suspended;
      }
      return null;
    }

    function ConcurrentHarness() {
      const [owner, setOwner] = useState<"a" | "b">("a");
      switchOwner = () => startTransition(() => setOwner("b"));
      return (
        <Suspense fallback={null}>
          <Discovery owner={owner} />
        </Suspense>
      );
    }

    act(() => root.render(<ConcurrentHarness />));
    await act(async () => {
      switchOwner();
      await Promise.resolve();
    });
    expect(renderSuspendedOwner).toBeGreaterThan(0);

    await act(async () => {
      releaseEnumeration();
      await enumeration;
    });
    await waitForReact(() => expect(committed.authority).toBe("complete"));

    expect(committed.ownerKey).toBe("a\u0000/workspace");
    expect(committed.packages[0]?.name).toBe("@repo/api");
  });

  it("fails closed while an invalidated same-owner discovery is pending", async () => {
    let releaseRescan: () => void = () => undefined;
    const rescan = new Promise<void>((resolve) => {
      releaseRescan = resolve;
    });
    let enumerationCount = 0;
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockImplementation(async () => {
      enumerationCount += 1;
      if (enumerationCount === 2) {
        await rescan;
      }
      return {
        files: ["package.json", "packages/api/package.json"],
        truncated: false,
        visited: 4,
      };
    });
    const harness = renderDiscovery(root, gateway);
    await waitForReact(() => expect(harness.current().authority).toBe("complete"));

    harness.invalidate();
    await waitForReact(() => expect(enumerationCount).toBe(2));

    expect(harness.current()).toEqual(
      expect.objectContaining({
        authority: "loading",
        loaded: false,
        packages: [],
      }),
    );
    expect(harness.current().packageForPath("/workspace/packages/api/src/index.ts")).toEqual({
      kind: "loading",
    });

    await act(async () => {
      releaseRescan();
      await rescan;
    });
  });

  it("debounces and coalesces rapid same-owner invalidations for 75 milliseconds", async () => {
    const gateway = packageGateway();
    const harness = renderDiscovery(root, gateway);
    await waitForReact(() => expect(harness.current().authority).toBe("complete"));

    harness.invalidate();
    await act(async () => {
      await new Promise((resolve) =>
        window.setTimeout(resolve, PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS / 3),
      );
    });
    harness.invalidate();
    await act(async () => {
      await new Promise((resolve) =>
        window.setTimeout(resolve, PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS / 3),
      );
    });
    harness.invalidate();
    await act(async () => {
      await new Promise((resolve) =>
        window.setTimeout(resolve, PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS + 10),
      );
    });
    expect(gateway.enumeratePackageJsonFiles).toHaveBeenCalledTimes(2);
    expect(harness.current().authority).toBe("complete");

    expect(PACKAGE_DISCOVERY_INVALIDATION_DEBOUNCE_MS).toBe(75);
  });

  it("retains parsed manifests for attribution when the root declares no workspace globs", async () => {
    const gateway = packageGateway();
    vi.mocked(gateway.readSourceTextBounded).mockImplementation(async (_rootPath, path) => {
      if (path === "package.json") {
        return { status: "ok", content: '{"name":"root"}' };
      }
      if (path === "packages/api/package.json") {
        return { status: "ok", content: '{"name":"@repo/api"}' };
      }
      return { status: "notFound" };
    });
    const harness = renderDiscovery(root, gateway);

    await waitForReact(() => expect(harness.current().authority).toBe("complete"));

    expect(harness.current().packages).toEqual([]);
    expect(harness.current().packageManifests).toEqual([
      { packageJson: { name: "root" }, relativeDirPath: "" },
      { packageJson: { name: "@repo/api" }, relativeDirPath: "packages/api" },
    ]);
  });

  it("retains successful manifests and scopes a malformed manifest to its directory", async () => {
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockResolvedValue({
      files: ["package.json", "packages/api/package.json", "packages/bad/package.json"],
      truncated: false,
      visited: 6,
    });
    vi.mocked(gateway.readSourceTextBounded).mockImplementation(async (_rootPath, path) => {
      if (path === "package.json") {
        return {
          status: "ok",
          content: '{"name":"root","workspaces":["packages/*"]}',
        };
      }
      if (path === "packages/api/package.json") {
        return { status: "ok", content: '{"name":"@repo/api"}' };
      }
      if (path === "packages/bad/package.json") {
        return { status: "ok", content: '{"name":"@repo/bad",}' };
      }
      return { status: "notFound" };
    });
    const harness = renderDiscovery(root, gateway);

    await waitForReact(() => expect(harness.current().authority).toBe("bounded"));

    expect(harness.current().packageManifests).toEqual([
      {
        packageJson: { name: "root", workspaces: ["packages/*"] },
        relativeDirPath: "",
      },
      { packageJson: { name: "@repo/api" }, relativeDirPath: "packages/api" },
    ]);
    expect(harness.current().incompleteDirectories).toEqual(["packages/bad"]);
    expect(harness.current().unscopedAuthorityUncertain).toBe(false);
  });

  it("rejects an oversized source before UTF-8 encoding or JSON parsing", async () => {
    const gateway = packageGateway();
    const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockResolvedValue({
      files: ["package.json"],
      truncated: false,
      visited: 1,
    });
    vi.mocked(gateway.readSourceTextBounded).mockImplementation(async (_rootPath, path) => {
      if (path === "pnpm-workspace.yaml") return { status: "notFound" };
      return {
        status: "ok",
        content: "x".repeat(256 * 1024 + 1),
      };
    });
    const harness = renderDiscovery(root, gateway);

    await waitForReact(() => expect(harness.current().authority).toBe("bounded"));

    expect(harness.current().incompleteDirectories).toEqual([""]);
    expect(harness.current().packageManifests).toEqual([]);
    expect(harness.current().unscopedAuthorityUncertain).toBe(true);
  });

  it("uses the backend effective package enumeration bounds", () => {
    expect(WORKSPACE_PACKAGE_DISCOVERY_LIMITS).toEqual({
      maxFiles: 256,
      maxVisited: 50_000,
    });
  });

  it("fails closed at the discovery deadline instead of retaining a hung owner", async () => {
    vi.useFakeTimers();
    try {
      const gateway = packageGateway();
      const enumeratePackageJsonFiles = gateway.enumeratePackageJsonFiles;
      expect(enumeratePackageJsonFiles).toBeDefined();
      vi.mocked(enumeratePackageJsonFiles!).mockReturnValue(new Promise(() => undefined));
      const harness = renderDiscovery(root, gateway);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WORKSPACE_PACKAGE_DISCOVERY_DEADLINE_MS);
      });

      expect(harness.current()).toEqual(
        expect.objectContaining({
          authority: "bounded",
          loaded: true,
          ownerKey: "workspace\u0000/workspace",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

function packageGateway(): WorkspaceSourceDiscoveryGateway {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(async () => ({
      files: [],
      truncated: false,
      visited: 0,
    })),
    enumeratePackageJsonFiles: vi.fn(async () => ({
      files: ["package.json", "packages/api/package.json"],
      truncated: false,
      visited: 4,
    })),
    readSourceTextBounded: vi.fn(
      async (_rootPath, relativePath): Promise<BoundedWorkspaceSourceRead> => {
        if (relativePath === "package.json") {
          return {
            status: "ok",
            content:
              '{"name":"workspace","devDependencies":{"turbo":"latest"},"workspaces":["packages/*"]}',
          };
        }
        if (relativePath === "packages/api/package.json") {
          return {
            status: "ok",
            content: '{"name":"@repo/api","dependencies":{"express":"latest"}}',
          };
        }
        return { status: "notFound" };
      },
    ),
  };
}

function renderDiscovery(
  root: Root,
  gateway: WorkspaceSourceDiscoveryGateway,
  initialRootPath = "/workspace",
  initialWorkspaceId = "workspace",
) {
  let current = {} as WorkspacePackageDiscovery;
  let setOwner: (rootPath: string, workspaceId: string) => void = () => undefined;
  let invalidate: () => void = () => undefined;

  function Harness() {
    const [owner, updateOwner] = useState({
      rootPath: initialRootPath,
      workspaceId: initialWorkspaceId,
    });
    const [discoveryVersion, setDiscoveryVersion] = useState(0);
    setOwner = (rootPath, workspaceId) => updateOwner({ rootPath, workspaceId });
    invalidate = () => setDiscoveryVersion((currentVersion) => currentVersion + 1);
    current = useWorkspacePackageGraph({
      discoveryVersion,
      enabled: true,
      gateway,
      processingRuntime: IMMEDIATE_PROCESSING_RUNTIME,
      rootPath: owner.rootPath,
      workspaceId: owner.workspaceId,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    current: () => current,
    invalidate: () => act(() => invalidate()),
    set: (rootPath: string, workspaceId: string) => act(() => setOwner(rootPath, workspaceId)),
  };
}
