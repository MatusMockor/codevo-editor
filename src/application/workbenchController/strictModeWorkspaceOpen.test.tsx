// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
} from "../../test/workbenchControllerTestHarness";
import { trustedDescriptor } from "../useWorkbenchController.preview/testSupport";

describe("workspace open under React StrictMode effect replay", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("opens a workspace root after a StrictMode mount replay", async () => {
    const unregister = vi.fn(async () => ({ status: "released" as const }));
    const { getWorkbench } = renderController({
      strictMode: true,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path: string) => trustedDescriptor("ws-strict", path)),
        unregister,
        adoptAdmission: vi.fn(async () => ({ status: "adopted" as const })),
        rollbackAdmission: vi.fn(async () => ({ status: "released" as const })),
      },
    });

    await flushAsyncTurns(24);

    let opened = false;
    await act(async () => {
      opened = await getWorkbench().openWorkspaceRoot("/selected/strict");
    });
    await flushAsyncTurns(24);

    expect(opened).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/selected/strict");
    expect(unregister).not.toHaveBeenCalledWith("ws-strict");
  });

  it("opens a workspace root without StrictMode", async () => {
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path: string) => trustedDescriptor("ws-plain", path)),
        unregister: vi.fn(async () => ({ status: "released" as const })),
        adoptAdmission: vi.fn(async () => ({ status: "adopted" as const })),
        rollbackAdmission: vi.fn(async () => ({ status: "released" as const })),
      },
    });

    await flushAsyncTurns(24);

    let opened = false;
    await act(async () => {
      opened = await getWorkbench().openWorkspaceRoot("/selected/plain");
    });
    await flushAsyncTurns(24);

    expect(opened).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/selected/plain");
  });
});
