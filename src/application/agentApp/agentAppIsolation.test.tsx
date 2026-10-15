// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTrustState } from "../../domain/trust";
import {
  renderAgentAppController,
  settleAgentApp,
  unmountAgentAppHarnesses,
} from "../../test/agentAppTestHarness";
import {
  agentDescriptor,
  agentIdentityGateway,
  agentRuntimeLifecycleGateway,
  agentTrustGateway,
  deferred,
} from "../../test/agentAppWorkspaceHarness";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

type Harness = ReturnType<typeof renderAgentAppController>;

function rotatingIdentityGateway() {
  let nextAdmissionToken = 0;
  return agentIdentityGateway({
    openPath: vi.fn(async (path: string) => {
      nextAdmissionToken += 1;
      return agentDescriptor(path === WORKSPACE_A ? "ws-a" : "ws-b", path, nextAdmissionToken);
    }),
  });
}

async function startOpen(harness: Harness, path: string) {
  let opening: Promise<unknown> = Promise.resolve(null);
  act(() => {
    opening = harness.current().openWorkspaceRootWithReceipt(path);
  });
  await settleAgentApp();
  return { opening };
}

async function activate(harness: Harness, path: string) {
  await act(async () => harness.current().activateWorkspaceTab(path));
  await settleAgentApp();
}

afterEach(() => {
  unmountAgentAppHarnesses();
});

describe("agent app workspace isolation through the controller", () => {
  it("closes a reopened A with its newest admission token after A to B to A", async () => {
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway();
    const harness = renderAgentAppController({
      identityGateway: rotatingIdentityGateway(),
      runtimeLifecycleGateway,
      strictMode: true,
    });
    await settleAgentApp();
    for (const path of [WORKSPACE_A, WORKSPACE_B, WORKSPACE_A]) await startOpen(harness, path);
    expect(harness.current().workspaceIdentityDescriptor).toMatchObject({
      workspaceId: "ws-a",
      admissionToken: 3,
    });

    await act(async () => harness.current().closeWorkspaceTab(WORKSPACE_A));
    await settleAgentApp();

    expect(runtimeLifecycleGateway.disposeRegisteredWorkspace).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "ws-a",
      admissionToken: 3,
      selectedRootPath: WORKSPACE_A,
      canonicalRootPath: WORKSPACE_A,
    });
    expect(harness.current().workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_B]);
  });

  it("never publishes late trust from the first A generation after A to B to A", async () => {
    const trustCalls: Array<{
      readonly pending: ReturnType<typeof deferred<WorkspaceTrustState>>;
      readonly rootPath: string;
    }> = [];
    const trustGateway = agentTrustGateway({
      getTrust: vi.fn((rootPath: string) => {
        const pending = deferred<WorkspaceTrustState>();
        trustCalls.push({ pending, rootPath });
        return pending.promise;
      }),
    });
    const harness = renderAgentAppController({ trustGateway });
    await settleAgentApp();

    await startOpen(harness, WORKSPACE_A);
    await startOpen(harness, WORKSPACE_B);
    const staleCalls = trustCalls.length;
    await startOpen(harness, WORKSPACE_A);
    expect(trustCalls.length).toBeGreaterThan(staleCalls);
    expect(trustCalls.slice(staleCalls).every((call) => call.rootPath === WORKSPACE_A)).toBe(true);

    await act(async () => {
      for (const call of trustCalls.slice(0, staleCalls)) {
        call.pending.resolve({ rootPath: call.rootPath, trusted: false });
      }
    });
    await settleAgentApp();
    expect(harness.current().workspaceTrust).toBeNull();

    await act(async () => {
      for (const call of trustCalls.slice(staleCalls)) {
        call.pending.resolve({ rootPath: WORKSPACE_A, trusted: true });
      }
    });
    await settleAgentApp();
    expect(harness.current().workspaceTrust).toEqual({ rootPath: WORKSPACE_A, trusted: true });
  });

  it("does not carry a trust toggle of A into B or into the next A generation", async () => {
    const trustGateway = agentTrustGateway();
    const harness = renderAgentAppController({ trustGateway });
    await settleAgentApp();
    await startOpen(harness, WORKSPACE_A);
    expect(harness.current().workspaceTrust).toEqual({ rootPath: WORKSPACE_A, trusted: true });

    await act(async () => harness.current().toggleWorkspaceTrust());
    expect(harness.current().workspaceTrust).toEqual({ rootPath: WORKSPACE_A, trusted: false });

    await startOpen(harness, WORKSPACE_B);
    expect(harness.current().workspaceTrust).toEqual({ rootPath: WORKSPACE_B, trusted: true });

    await activate(harness, WORKSPACE_A);
    expect(harness.current().workspaceRoot).toBe(WORKSPACE_A);
    expect(harness.current().workspaceTrust).toEqual({ rootPath: WORKSPACE_A, trusted: true });
  });

  it("clears the active workspace when its last tab closes", async () => {
    const harness = renderAgentAppController();
    await settleAgentApp();
    await startOpen(harness, WORKSPACE_A);

    await act(async () => harness.current().closeWorkspaceTab(WORKSPACE_A));
    await settleAgentApp();

    expect(harness.current().workspaceRoot).toBeNull();
    expect(harness.current().workspaceTrust).toBeNull();
    expect(harness.current().windowTitle).toBe("Agents");
  });
});
