import { describe, expect, it, vi } from "vitest";
import type { DebugGateway } from "../domain/debug";
import type { NativeNodeWatchDebugGateway } from "../domain/nativeNodeWatchDebugGateway";
import { nativeNodeWatchDebugStartDescriptor } from "./debugStartDescriptor";
import { clonePreparedNodeDebugLaunch } from "./nodeDebugPreparedLaunchRecipe";
import { prepareNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";

const entry = {
  source: "vscode" as const,
  configuration: {
    args: [],
    default: true,
    env: {},
    name: "Watch server",
    target: { kind: "script" as const, path: "src/server.js" },
  },
  nativeWatch: {
    kind: "native-node-watch" as const,
    scriptPath: "src/server.js",
    watch: true as const,
    preserveOutput: true as const,
  },
  justMyCode: "nodeInternals" as const,
  sourceMaps: false,
  preLaunchTask: "build server",
  postDebugTask: "clean server",
};

describe("native Node watch debug orchestration recipes", () => {
  it("prepares and defensively clones the private absolute watch recipe", () => {
    const prepared = prepareNodeDebugLaunch(
      entry.configuration,
      "/workspace",
      entry,
      (path) => path === "/workspace/src/server.js",
    );

    expect(prepared).toMatchObject({
      kind: "supported",
      value: {
        nativeWatch: {
          kind: "native-node-watch",
          scriptPath: "/workspace/src/server.js",
          watch: true,
          preserveOutput: true,
        },
        preLaunchTask: { label: "build server" },
        postDebugTask: { label: "clean server" },
      },
    });
    if (prepared.kind !== "supported") return;
    const clone = clonePreparedNodeDebugLaunch(prepared.value);
    expect(clone).toEqual(prepared.value);
    expect(clone?.nativeWatch).not.toBe(prepared.value.nativeWatch);
  });

  it("blocks a dirty exact target while leaving legacy launches unchanged", () => {
    expect(prepareNodeDebugLaunch(entry.configuration, "/workspace", entry, () => false)).toEqual({
      kind: "unsupported",
      reason: "dirtyDocument",
    });

    const legacyEntry = {
      source: "codevo" as const,
      configuration: entry.configuration,
    };
    expect(
      prepareNodeDebugLaunch(entry.configuration, "/workspace", legacyEntry, () => false).kind,
    ).toBe("supported");
  });

  it("builds the dedicated descriptor payload and never calls generic debug_start", async () => {
    const genericStart = vi.fn<DebugGateway["start"]>();
    const startNativeNodeWatch = vi
      .fn<NativeNodeWatchDebugGateway["startNativeNodeWatch"]>()
      .mockResolvedValue({ kind: "ok", sessionId: 31 });
    const confirmNativeNodeWatch = vi.fn(async () => undefined);
    const descriptor = nativeNodeWatchDebugStartDescriptor(
      { startNativeNodeWatch, confirmNativeNodeWatch },
      {
        scriptPath: "/workspace/src/server.js",
        sourceMaps: false,
        watch: true,
        preserveOutput: true,
        justMyCode: "nodeInternals",
      },
    );

    expect(descriptor.exceptionTypeFilterSupported).toBe(true);
    await expect(
      descriptor.start(
        "/workspace",
        [
          {
            id: "entry",
            filePath: "/workspace/src/server.js",
            lineNumber: 4,
            enabled: true,
          },
        ],
        "uncaught",
        ["TypeError", "app.DomainError"],
        [{ id: "function-entry", functionName: "startServer", enabled: true }],
      ),
    ).resolves.toEqual({ kind: "ok", sessionId: 31 });
    expect(descriptor.restartLaunch).toBeNull();
    await expect(descriptor.confirmStart?.("/workspace", 31)).resolves.toBeUndefined();
    expect(confirmNativeNodeWatch).toHaveBeenCalledExactlyOnceWith("/workspace", 31);
    expect(startNativeNodeWatch).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace",
      scriptPath: "/workspace/src/server.js",
      watch: true,
      preserveOutput: true,
      breakpoints: [
        {
          id: "entry",
          filePath: "/workspace/src/server.js",
          lineNumber: 4,
          enabled: true,
        },
      ],
      functionBreakpoints: [{ id: "function-entry", functionName: "startServer", enabled: true }],
      exceptionPauseMode: "uncaught",
      exceptionTypeFilter: ["TypeError", "app.DomainError"],
      justMyCode: "nodeInternals",
      sourceMaps: false,
    });
    expect(genericStart).not.toHaveBeenCalled();
  });

  it("preserves a gateway rejection without inventing a session", async () => {
    const descriptor = nativeNodeWatchDebugStartDescriptor(
      {
        confirmNativeNodeWatch: vi.fn(async () => undefined),
        startNativeNodeWatch: vi.fn(async () => ({
          kind: "error" as const,
          message: "watch unavailable",
        })),
      },
      { scriptPath: "/workspace/server.js", watch: true },
    );

    await expect(descriptor.start("/workspace", [], "none", [])).resolves.toEqual({
      kind: "error",
      message: "watch unavailable",
    });
  });
});
