// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import wire from "../../../contracts/workspace-owner-release-wire.json";
import { TauriWorkspaceIdentityGateway } from "../../infrastructure/tauriWorkspaceIdentityGateway";
import { TauriWorkspaceRuntimeLifecycleGateway } from "../../infrastructure/tauriWorkspaceRuntimeLifecycleGateway";
import {
  flushAgentTurns,
  renderAgentWorkspaceHarness,
  unmountAgentWorkspaceHarnesses,
} from "../../test/agentAppWorkspaceHarness";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

interface FakeAdmission {
  readonly token: number;
  readonly workspaceId: string;
  readonly selectedPath: string;
  readonly canonicalRoot: string;
}

type FakeCommandFault = "failBeforeApplying" | "failAfterApplying";

class FakeAdmissionBackend {
  readonly admissions = new Map<number, FakeAdmission>();
  readonly teardowns = new Map<string, number>();
  readonly faults = new Map<string, FakeCommandFault[]>();
  private nextToken = 0;

  async handle(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const fault = this.faults.get(command)?.shift();
    if (fault === "failBeforeApplying") throw new Error(`${command} transport lost`);
    const result = this.apply(command, args);
    if (fault === "failAfterApplying") throw new Error(`${command} reply lost`);
    return result;
  }

  liveTokens(workspaceId: string): readonly number[] {
    return [...this.admissions.values()]
      .filter((admission) => admission.workspaceId === workspaceId)
      .map((admission) => admission.token);
  }

  private apply(command: string, args: Record<string, unknown>): unknown {
    switch (command) {
      case "register_workspace_path":
        return this.register(String(args.rootPath));
      case "adopt_workspace_admission":
        return contractStatus(
          wire.adoptWorkspaceAdmission.statuses,
          this.adopt(String(args.workspaceId), Number(args.newToken), Number(args.replacedToken)),
        );
      case "rollback_workspace_registration":
        return contractStatus(
          wire.rollbackWorkspaceRegistration.statuses,
          this.rollback(String(args.workspaceId), Number(args.admissionToken)),
        );
      case "unregister_workspace":
        return contractStatus(
          wire.unregisterWorkspace.statuses,
          this.unregister(
            String(args.workspaceId),
            Number(args.admissionToken),
            String(args.canonicalRootPath),
          ),
        );
      case "dispose_registered_workspace":
        return this.dispose(
          args.request as {
            readonly workspaceId: string;
            readonly admissionToken: number;
            readonly canonicalRootPath: string;
          },
        );
      default:
        throw new Error(`Unexpected command ${command}`);
    }
  }

  private register(rootPath: string) {
    this.nextToken += 1;
    const workspaceId = `ws${rootPath}`;
    const admission = {
      token: this.nextToken,
      workspaceId,
      selectedPath: rootPath,
      canonicalRoot: rootPath,
    };
    this.admissions.set(admission.token, admission);
    return {
      descriptor: {
        workspaceId,
        selectedRootPath: rootPath,
        canonicalRootPath: rootPath,
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      },
      registration: { workspaceId, admissionToken: admission.token, createdIdentity: true },
    };
  }

  private adopt(workspaceId: string, newToken: number, replacedToken: number): string {
    if (this.liveTokens(workspaceId).length === 0) return "unknownWorkspace";
    if (this.admissions.get(newToken)?.workspaceId !== workspaceId) return "staleAdmission";
    this.admissions.delete(replacedToken);
    return "adopted";
  }

  private rollback(workspaceId: string, token: number): string {
    if (this.admissions.get(token)?.workspaceId !== workspaceId) return "staleOwner";
    return this.removeEditorAdmission(token);
  }

  private unregister(workspaceId: string, token: number, canonicalRoot: string): string {
    if (this.ownerIsStale(workspaceId, token, canonicalRoot)) return "staleOwner";
    return this.removeEditorAdmission(token);
  }

  private dispose(request: {
    readonly workspaceId: string;
    readonly admissionToken: number;
    readonly canonicalRootPath: string;
  }) {
    if (this.liveTokens(request.workspaceId).length === 0) return { status: "unknownWorkspace" };
    if (this.ownerIsStale(request.workspaceId, request.admissionToken, request.canonicalRootPath)) {
      throw new Error("workspace close identity is stale");
    }
    const status = this.removeEditorAdmission(request.admissionToken);
    return { status: status === "released" ? "closed" : status };
  }

  private ownerIsStale(workspaceId: string, token: number, canonicalRoot: string): boolean {
    const admission = this.admissions.get(token);
    if (admission?.workspaceId !== workspaceId || admission.canonicalRoot !== canonicalRoot) {
      return true;
    }
    return [...this.admissions.values()].some(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.selectedPath === admission.selectedPath &&
        candidate.token > token,
    );
  }

  private removeEditorAdmission(token: number): string {
    const admission = this.admissions.get(token);
    if (admission === undefined) return "staleOwner";
    this.admissions.delete(token);
    if (this.liveTokens(admission.workspaceId).length > 0) return "retainedByOtherOwners";
    this.teardowns.set(admission.workspaceId, (this.teardowns.get(admission.workspaceId) ?? 0) + 1);
    return "released";
  }
}

function contractStatus(statuses: readonly string[], status: string) {
  expect(statuses).toContain(status);
  return { status };
}

afterEach(() => {
  unmountAgentWorkspaceHarnesses();
  invoke.mockReset();
});

function renderBackendHarness() {
  const backend = new FakeAdmissionBackend();
  invoke.mockImplementation((command: string, args?: Record<string, unknown>) =>
    backend.handle(command, args),
  );
  const identityGateway = new TauriWorkspaceIdentityGateway();
  const runtimeLifecycleGateway = new TauriWorkspaceRuntimeLifecycleGateway(
    (command, args) => backend.handle(command, args),
    () => true,
  );
  const harness = renderAgentWorkspaceHarness({
    identityGateway,
    releaseRetryDelay: async () => undefined,
    runtimeLifecycleGateway,
  });
  return { backend, harness, identityGateway };
}

async function activate(harness: ReturnType<typeof renderAgentWorkspaceHarness>, path: string) {
  await act(async () => harness.current().transition.activateWorkspaceTab(path));
  await flushAgentTurns();
}

async function closeTab(harness: ReturnType<typeof renderAgentWorkspaceHarness>, path: string) {
  await act(async () => harness.current().close.closeWorkspaceTab(path));
  await flushAgentTurns();
}

describe("agent workspace admission lifecycle against a modelled backend", () => {
  it("tears A down exactly once after A to B to A reopens and a close", async () => {
    const { backend, harness, identityGateway } = renderBackendHarness();
    await flushAgentTurns();

    await activate(harness, "/a");
    await activate(harness, "/b");
    await activate(harness, "/a");
    const reopened = harness.current().transition.workspaceIdentityDescriptor;
    expect(reopened).toMatchObject({ workspaceId: "ws/a", admissionToken: 3 });
    expect(backend.liveTokens("ws/a")).toEqual([3]);

    await closeTab(harness, "/a");

    expect(backend.teardowns.get("ws/a")).toBe(1);
    expect(backend.liveTokens("ws/a")).toEqual([]);
    expect(backend.liveTokens("ws/b")).toEqual([4]);
    expect(backend.teardowns.get("ws/b")).toBeUndefined();
    expect(harness.current().transition.workspaceRoot).toBe("/b");
    expect(identityGateway.descriptorForPath("/a/src/App.ts")).toBeNull();
    expect(harness.errors).toEqual([]);
  });

  it("retries an adoption whose reply was lost instead of rolling it back", async () => {
    const { backend, harness } = renderBackendHarness();
    await flushAgentTurns();
    await activate(harness, "/a");
    await activate(harness, "/b");
    backend.faults.set("adopt_workspace_admission", ["failAfterApplying"]);

    await activate(harness, "/a");

    expect(backend.liveTokens("ws/a")).toEqual([3]);
    await closeTab(harness, "/a");
    expect(backend.teardowns.get("ws/a")).toBe(1);
    expect(backend.liveTokens("ws/a")).toEqual([]);
  });

  it("reports an already gone workspace close as closed", async () => {
    const { backend, harness } = renderBackendHarness();
    await flushAgentTurns();
    await activate(harness, "/a");
    await activate(harness, "/b");
    backend.admissions.delete(1);

    await closeTab(harness, "/a");

    expect(backend.teardowns.get("ws/a")).toBeUndefined();
    expect(harness.current().appSettings.workspaceTabs).toEqual(["/b"]);
    expect(harness.errors).toEqual([]);
  });
});
