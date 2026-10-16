// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import wire from "../../../contracts/workspace-owner-release-wire.json";
import { TauriWorkspaceIdentityGateway } from "../../infrastructure/tauriWorkspaceIdentityGateway";
import { TauriWorkspaceRuntimeLifecycleGateway } from "../../infrastructure/tauriWorkspaceRuntimeLifecycleGateway";
import { CloseCoordinator } from "../closeCoordinator";
import {
  prepareRegisteredWorkspaceClose,
  RegisteredWorkspaceCloseCoordinator,
} from "../registeredWorkspaceCloseCoordinator";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { useManagedWorkspaceIdentityOwnership } from "./useManagedWorkspaceIdentityOwnership";
import { useWorkspaceIdentityAuthority } from "./useWorkspaceIdentityAuthority";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  readonly gates = new Map<string, Promise<void>>();
  private nextToken = 0;

  async handle(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.gates.get(command);
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

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  invoke.mockReset();
});

describe("workspace admission lifecycle against a modelled backend", () => {
  it("tears A down exactly once after overlapping A to B to A reopens and a close", async () => {
    const { backend, identityGateway, ownership, runtimeGateway } = renderBackendHarness();

    const t1 = await openAndAdopt(identityGateway, ownership, "/a");
    const b = await openAndAdopt(identityGateway, ownership, "/b");
    const t2 = await identityGateway.openPath("/a");
    const t3 = await identityGateway.openPath("/a");
    let releaseT2Adoption: () => void = () => undefined;
    const t2Gate = new Promise<void>((resolve) => {
      releaseT2Adoption = resolve;
    });
    const t2Adoption = { adopted: null as boolean | null };
    const reopeningT2 = ownership().withManagedLease(t2, async (adopt) => {
      await t2Gate;
      t2Adoption.adopted = await adopt();
    });
    await ownership().withManagedLease(t3, async (adopt) => {
      await expect(adopt()).resolves.toBe(true);
    });
    releaseT2Adoption();
    await reopeningT2;

    expect(t2Adoption.adopted).toBe(false);
    expect(backend.liveTokens(t1.workspaceId)).toEqual([t3.admissionToken]);

    await expect(closeRegisteredWorkspace(ownership, t3, runtimeGateway)).resolves.toEqual({
      status: "closed",
    });

    expect(backend.teardowns.get(t1.workspaceId)).toBe(1);
    expect(backend.liveTokens(t1.workspaceId)).toEqual([]);
    expect(backend.liveTokens(b.workspaceId)).toEqual([b.admissionToken]);
    expect(backend.teardowns.get(b.workspaceId)).toBeUndefined();
    expect(identityGateway.descriptorForPath("/a/src/App.ts")).toBeNull();
    expect(identityGateway.descriptorForPath("/b/src/App.ts")).toBe(b);
  });

  it("retries an adoption whose reply was lost instead of rolling it back", async () => {
    const { backend, identityGateway, ownership, runtimeGateway } = renderBackendHarness();
    const t1 = await openAndAdopt(identityGateway, ownership, "/a");
    backend.faults.set("adopt_workspace_admission", ["failAfterApplying"]);

    const t2 = await openAndAdopt(identityGateway, ownership, "/a");

    expect(backend.liveTokens(t1.workspaceId)).toEqual([t2.admissionToken]);
    await expect(closeRegisteredWorkspace(ownership, t2, runtimeGateway)).resolves.toEqual({
      status: "closed",
    });
    expect(backend.teardowns.get(t1.workspaceId)).toBe(1);
    expect(backend.liveTokens(t1.workspaceId)).toEqual([]);
  });

  it("flushes a failed rollback before the owner close so teardown happens exactly once", async () => {
    const { backend, identityGateway, ownership, runtimeGateway } = renderBackendHarness(
      () => new Promise<void>(() => undefined),
    );
    const t1 = await openAndAdopt(identityGateway, ownership, "/a");
    const abandoned = await identityGateway.openPath("/a");
    backend.faults.set("rollback_workspace_registration", ["failBeforeApplying"]);

    await ownership().withManagedLease(abandoned, async () => undefined);
    expect(backend.liveTokens(t1.workspaceId)).toEqual([
      t1.admissionToken,
      abandoned.admissionToken,
    ]);

    await expect(closeRegisteredWorkspace(ownership, t1, runtimeGateway)).resolves.toEqual({
      status: "closed",
    });

    expect(backend.teardowns.get(t1.workspaceId)).toBe(1);
    expect(backend.liveTokens(t1.workspaceId)).toEqual([]);
  });

  it("lets the latest reopen win when an earlier adoption reply arrives after it", async () => {
    const { backend, identityGateway, ownership, runtimeGateway } = renderBackendHarness();
    const t1 = await openAndAdopt(identityGateway, ownership, "/a");
    const t2 = await identityGateway.openPath("/a");
    const t3 = await identityGateway.openPath("/a");
    let releaseAdoptions: () => void = () => undefined;
    backend.gates.set(
      "adopt_workspace_admission",
      new Promise<void>((resolve) => {
        releaseAdoptions = resolve;
      }),
    );
    const t2Adoption = { adopted: null as boolean | null };
    const reopeningT2 = ownership().withManagedLease(t2, async (adopt) => {
      t2Adoption.adopted = await adopt();
    });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("adopt_workspace_admission", expect.anything()),
    );
    const reopeningT3 = ownership().withManagedLease(t3, async (adopt) => {
      await expect(adopt()).resolves.toBe(true);
    });
    releaseAdoptions();
    await Promise.all([reopeningT2, reopeningT3]);

    expect(t2Adoption.adopted).toBe(false);
    expect(backend.liveTokens(t1.workspaceId)).toEqual([t3.admissionToken]);
    await expect(closeRegisteredWorkspace(ownership, t3, runtimeGateway)).resolves.toEqual({
      status: "closed",
    });
    expect(backend.teardowns.get(t1.workspaceId)).toBe(1);
  });

  it("reports an already gone workspace close as closed", async () => {
    const { backend, identityGateway, ownership, runtimeGateway } = renderBackendHarness();
    const t1 = await openAndAdopt(identityGateway, ownership, "/a");
    backend.admissions.delete(t1.admissionToken ?? 0);

    await expect(closeRegisteredWorkspace(ownership, t1, runtimeGateway)).resolves.toEqual({
      status: "closed",
    });
    expect(backend.teardowns.get(t1.workspaceId)).toBeUndefined();
  });
});

async function openAndAdopt(
  identityGateway: TauriWorkspaceIdentityGateway,
  ownership: () => ReturnType<typeof useManagedWorkspaceIdentityOwnership>,
  path: string,
): Promise<WorkspaceIdentityDescriptor> {
  const descriptor = await identityGateway.openPath(path);
  await ownership().withManagedLease(descriptor, async (adopt) => {
    await expect(adopt()).resolves.toBe(true);
  });
  return descriptor;
}

async function closeRegisteredWorkspace(
  ownership: () => ReturnType<typeof useManagedWorkspaceIdentityOwnership>,
  descriptor: WorkspaceIdentityDescriptor,
  runtimeGateway: TauriWorkspaceRuntimeLifecycleGateway,
) {
  const settlement = ownership().prepareBackendClosedSettlement(descriptor);
  expect(settlement?.isCurrent()).toBe(true);
  await settlement?.flushCompensations();
  const preparation = prepareRegisteredWorkspaceClose(
    descriptor,
    () => settlement?.isCurrent() === true,
  );
  expect(preparation.status).toBe("ready");
  if (preparation.status !== "ready" || settlement === null) return null;
  const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1));
  const result = await coordinator.close({
    lease: preparation.lease,
    closeDocuments: [],
    disposeRegisteredWorkspace: (target) => runtimeGateway.disposeRegisteredWorkspace(target),
  });
  expect(settlement.settle(() => undefined)).toBe(true);
  return result;
}

function renderBackendHarness(
  releaseRetryDelay: (delayMs: number) => Promise<void> = async () => undefined,
) {
  const backend = new FakeAdmissionBackend();
  invoke.mockImplementation((command: string, args?: Record<string, unknown>) =>
    backend.handle(command, args),
  );
  const identityGateway = new TauriWorkspaceIdentityGateway();
  const runtimeGateway = new TauriWorkspaceRuntimeLifecycleGateway(
    (command, args) => backend.handle(command, args),
    () => true,
  );
  const captured: { ownership: ReturnType<typeof useManagedWorkspaceIdentityOwnership> | null } = {
    ownership: null,
  };
  const root = createRoot(document.createElement("div"));
  mountedRoots.push(root);

  function Harness(): null {
    const authority = useWorkspaceIdentityAuthority();
    captured.ownership = useManagedWorkspaceIdentityOwnership({
      deferredCleanupIdsRef: authority.deferredWorkspaceIdentityCleanupIdsRef,
      identityGateway,
      identityRequestTokensRef: authority.pendingWorkspaceIdentityRequestTokensRef,
      latestAdmissionGenerationByIdRef: authority.latestWorkspaceIdentityAdmissionGenerationByIdRef,
      mountedRef: { current: true },
      nextAdmissionGenerationRef: authority.workspaceIdentityAdmissionGenerationRef,
      ownedGenerationByIdRef: authority.ownedWorkspaceIdentityGenerationByIdRef,
      ownedIdsRef: authority.ownedWorkspaceIdentityIdsRef,
      pendingAdmissionsRef: authority.pendingWorkspaceIdentityAdmissionsRef,
      releasedIdsRef: authority.releasedWorkspaceIdentityIdsRef,
      releaseGenerationByIdRef: authority.workspaceIdentityReleaseGenerationByIdRef,
      releaseRetryDelay,
      reportError: vi.fn(),
      retireRuntimeOwnerClaim: vi.fn(),
      runtimeOwnerClaimsRef: { current: { generationFor: () => undefined } },
      unregisterByIdRef: authority.workspaceIdentityUnregisterByIdRef,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  const ownership = () => {
    expect(captured.ownership).not.toBeNull();
    return captured.ownership as ReturnType<typeof useManagedWorkspaceIdentityOwnership>;
  };
  return { backend, identityGateway, ownership, runtimeGateway };
}
