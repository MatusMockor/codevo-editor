import { describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import {
  TauriNodePackageScriptsGateway,
  type ListenToNodePackageTaskEvents,
} from "./tauriNodePackageScriptsGateway";
import type { InvokeNodePackageScriptsCommand } from "./tauriNodePackageScriptsIpcContract";

const ROOT = "/workspace/project";
const limits = { maxManifests: 10, maxScripts: 20, maxVisited: 100 };

describe("TauriNodePackageScriptsGateway", () => {
  it("translates the exact registered root into its opaque workspace id", async () => {
    const invoke = vi.fn<InvokeNodePackageScriptsCommand>().mockResolvedValue(result());
    const gateway = new TauriNodePackageScriptsGateway(identities(), invoke);

    await gateway.listNodePackageScripts(ROOT, limits);

    expect(invoke).toHaveBeenCalledWith("workspace_discover_node_package_scripts", {
      request: { workspaceId: "ws-1", ...limits },
    });
  });

  it("forwards typed start and stop requests without turning them into shell input", async () => {
    const invoke = vi
      .fn<InvokeNodePackageScriptsCommand>()
      .mockResolvedValueOnce({ runId: "run-1" })
      .mockResolvedValueOnce(null);
    const gateway = new TauriNodePackageScriptsGateway(identities(), invoke);
    const request = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 12,
      manifestRelativePath: "apps/web/package.json",
      repositoryRoot: ROOT,
      scriptName: "build prod ✓",
      target: { kind: "workspaceRoot" as const },
    };

    await expect(gateway.startNodePackageTask(request)).resolves.toEqual({ runId: "run-1" });
    expect(invoke).toHaveBeenCalledWith("workspace_start_node_package_task", {
      request,
    });
    invoke.mockResolvedValueOnce(null);
    await expect(
      gateway.acknowledgeNodePackageTaskStart({
        runId: "run-1",
        workspaceId: "ws-1",
      }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.stopNodePackageTask({ runId: "run-1", workspaceId: "ws-1" }),
    ).resolves.toBeUndefined();
  });

  it("subscribes to the exact event and drops malformed payloads", async () => {
    let listener!: (event: { payload: unknown }) => void;
    const unlisten = vi.fn();
    const listen = vi.fn<ListenToNodePackageTaskEvents>(async (_event, handler) => {
      listener = handler;
      return unlisten;
    });
    const gateway = new TauriNodePackageScriptsGateway(identities(), vi.fn(), listen);
    const handler = vi.fn();
    const unsubscribe = await gateway.subscribeNodePackageTaskEvents(handler);

    expect(listen).toHaveBeenCalledWith("node-package-task://status", expect.any(Function));
    listener?.({ payload: { status: "running", runId: "run-1" } });
    expect(handler).not.toHaveBeenCalled();
    listener?.({
      payload: {
        status: "running",
        runId: "run-1",
        workspaceId: "ws-1",
        sessionId: 12,
        manifestRelativePath: "apps/web/package.json",
        scriptName: "build",
      },
    });
    expect(handler).toHaveBeenCalledOnce();
    unsubscribe();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("subscribes independently to output and problems and drops malformed payloads", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const listen = vi.fn<ListenToNodePackageTaskEvents>(async (name, handler) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    });
    const gateway = new TauriNodePackageScriptsGateway(identities(), vi.fn(), listen);
    const output = vi.fn();
    const problems = vi.fn();
    await gateway.subscribeNodePackageTaskOutputEvents(output);
    await gateway.subscribeNodePackageTaskProblemsEvents(problems);
    const owner = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 2,
      manifestRelativePath: "package.json",
      scriptName: "lint",
    };
    listeners.get("node-package-task://output")?.({
      payload: { owner, sequence: 1, stream: "stdout", data: "ok", truncated: false },
    });
    listeners.get("node-package-task://problems")?.({
      payload: { kind: "clear", owner, sequence: 2 },
    });
    listeners.get("node-package-task://problems")?.({ payload: { kind: "clear" } });
    expect(output).toHaveBeenCalledOnce();
    expect(problems).toHaveBeenCalledOnce();
  });

  it.each(["/other", `${ROOT}/packages/app`])(
    "rejects an unopened or nested discovery root before IPC",
    (root) => {
      const invoke = vi.fn<InvokeNodePackageScriptsCommand>();
      const gateway = new TauriNodePackageScriptsGateway(identities(), invoke);
      expect(() => gateway.listNodePackageScripts(root, limits)).toThrow(
        "opened native workspace root",
      );
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});

function identities(): WorkspaceIdentityDescriptorResolver {
  return {
    descriptorForPath: () => null,
    matchForPath: (path) =>
      path === ROOT || path === `${ROOT}/packages/app`
        ? {
            descriptor: {
              workspaceId: "ws-1",
              selectedPath: ROOT,
              canonicalRoot: ROOT,
              caseSensitive: true,
              unicodeNormalizationPolicy: "preserved",
              policy: { caseSensitive: true, unicodeNormalization: "none" },
            },
            matchedRoot: ROOT,
            relativePath: path === ROOT ? "" : "packages/app",
          }
        : null,
  };
}

function result() {
  return {
    scripts: [],
    total: 0,
    truncated: false,
    visited: 1,
  };
}
