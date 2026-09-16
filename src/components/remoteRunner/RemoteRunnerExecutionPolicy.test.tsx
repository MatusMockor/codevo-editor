// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerDescriptor, RemoteRunnerGateway } from "../../domain/remoteRunner";
import { RemoteRunnerExecutionPolicy } from "./RemoteRunnerExecutionPolicy";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const descriptor = (timeoutMs?: number): RemoteRunnerDescriptor => ({
  protocolVersion: 1,
  runnerId: "runner",
  name: "Linux",
  capabilities: { taskExecution: true, eventReplay: true },
  ...(timeoutMs === undefined ? {} : { executionTimeoutMs: timeoutMs }),
});
function setup(getRunner: RemoteRunnerGateway["getRunner"]) {
  const gateway = { getRunner } as RemoteRunnerGateway;
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (serverId: string, connected = true) =>
    act(async () => {
      root.render(
        <RemoteRunnerExecutionPolicy gateway={gateway} serverId={serverId} connected={connected} />,
      );
    });
  return { host, render, close: () => act(() => root.unmount()) };
}

describe("RemoteRunnerExecutionPolicy", () => {
  it("shows the server's actual limit and distinguishes closing from restarting", async () => {
    const view = setup(vi.fn().mockResolvedValue(descriptor(43_200_000)));
    try {
      await view.render("A");
      expect(view.host.textContent).toContain("Run limit: 12 hours");
      expect(view.host.textContent).toContain("including time waiting for your answers");
      expect(view.host.textContent).toContain("Closing the editor keeps tasks running");
      expect(view.host.textContent).toContain("Restarting the server interrupts them");
    } finally {
      view.close();
    }
  });

  it.each([1_800_000, 60_000, 604_800_000])(
    "shows configured deadlines without assuming the default: %s",
    async (ms) => {
      const view = setup(vi.fn().mockResolvedValue(descriptor(ms)));
      try {
        await view.render("A");
        expect(view.host.textContent).toContain(
          ms >= 3_600_000 ? "168 hours" : `${ms / 60_000} ${ms === 60_000 ? "minute" : "minutes"}`,
        );
      } finally {
        view.close();
      }
    },
  );

  it("does not invent a deadline for old or unavailable runners", async () => {
    const getRunner = vi
      .fn()
      .mockResolvedValueOnce(descriptor())
      .mockRejectedValueOnce(new Error("offline"));
    const view = setup(getRunner);
    try {
      await view.render("A");
      expect(view.host.textContent).toContain("Run limit is not available");
      await view.render("B");
      expect(view.host.textContent).toContain("Run limit is not available");
      await view.render("B", false);
      expect(view.host.textContent).toBe("");
    } finally {
      view.close();
    }
  });

  it("ignores an old connection response across A to B to A", async () => {
    let resolveOld!: (value: RemoteRunnerDescriptor) => void;
    const getRunner = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<RemoteRunnerDescriptor>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(descriptor(60_000))
      .mockResolvedValueOnce(descriptor(43_200_000));
    const view = setup(getRunner);
    try {
      await view.render("A");
      await view.render("B");
      await view.render("A");
      await act(async () => resolveOld(descriptor(1_800_000)));
      expect(view.host.textContent).toContain("12 hours");
      expect(view.host.textContent).not.toContain("30 minutes");
    } finally {
      view.close();
    }
  });
});
