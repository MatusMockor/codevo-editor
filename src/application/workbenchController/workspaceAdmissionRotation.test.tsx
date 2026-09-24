// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRuntimeLifecycleGateway } from "../../domain/workspaceRuntimeLifecycle";
import { flushAsyncTurns } from "../../test/workbenchControllerTestHarness";
import {
  setupRegisteredWorkbenchControllerTestHarness,
  trustedDescriptor,
  workspaceAdmissionDoubles,
} from "../../test/workbenchRegisteredAuthorityTestFixtures";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

describe("workspace admission token rotation", () => {
  const { renderController } = setupRegisteredWorkbenchControllerTestHarness();

  it("closes a reopened A with its newest admission token after A to B to A", async () => {
    let nextAdmissionToken = 0;
    const openPath = vi.fn(async (path: string) => {
      nextAdmissionToken += 1;
      return trustedDescriptor(path === WORKSPACE_A ? "ws-a" : "ws-b", path, nextAdmissionToken);
    });
    const disposeRegisteredWorkspace = vi.fn<
      NonNullable<WorkspaceRuntimeLifecycleGateway["disposeRegisteredWorkspace"]>
    >(async () => ({ status: "closed" }));
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath,
        ...workspaceAdmissionDoubles(),
      },
      workspaceRuntimeLifecycleGateway: {
        disposeWorkspace: vi.fn(async () => undefined),
        disposeRegisteredWorkspace,
      },
    });

    for (const path of [WORKSPACE_A, WORKSPACE_B, WORKSPACE_A]) {
      await act(async () => {
        await getWorkbench().activateWorkspaceTab(path);
        await flushAsyncTurns(24);
      });
    }

    expect(getWorkbench().workspaceIdentityDescriptor).toMatchObject({
      workspaceId: "ws-a",
      admissionToken: 3,
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(WORKSPACE_A);
      await flushAsyncTurns(24);
    });

    expect(disposeRegisteredWorkspace).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "ws-a",
      admissionToken: 3,
      selectedRootPath: WORKSPACE_A,
      canonicalRootPath: WORKSPACE_A,
    });
  });
});
