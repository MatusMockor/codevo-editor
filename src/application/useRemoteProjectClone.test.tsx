// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../domain/remoteRunner";
import { useRemoteProjectClone, type RemoteProjectCloneStart } from "./useRemoteProjectClone";
const job: RemoteRunnerCloneJob = { id: "clone", status: "running", project: null, error: null };
const input = { url: "git@github.com:owner/project.git", name: "project" };
let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});
function setup() {
  const cloneProject = vi.fn().mockResolvedValue(job);
  const getProjectClone = vi.fn().mockResolvedValue(job);
  const cancelProjectClone = vi.fn().mockResolvedValue({ ...job, status: "cancelled" });
  const gateway = {
    cloneProject,
    getProjectClone,
    cancelProjectClone,
  } as unknown as RemoteRunnerGateway;
  const root = createRoot(document.createElement("div"));
  let result!: ReturnType<typeof useRemoteProjectClone>;
  function Harness({ server, connected }: { server: string; connected: boolean }) {
    result = useRemoteProjectClone({
      gateway: connected ? gateway : null,
      serverId: server,
      workspaceOwner: "workspace",
    });
    return null;
  }
  const render = (server: string, connected = true) =>
    act(() => root.render(<Harness server={server} connected={connected} />));
  render("a");
  dispose = () => act(() => root.unmount());
  return {
    get result() {
      return result;
    },
    cloneProject,
    getProjectClone,
    cancelProjectClone,
    render,
  };
}
it("polls a durable clone until success", async () => {
  const view = setup();
  view.getProjectClone.mockResolvedValue({
    ...job,
    status: "succeeded",
    project: { id: "project", name: "project" },
  });
  await act(async () => {
    await view.result.start(input);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.result.job?.status).toBe("succeeded");
  expect(view.result.busy).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(view.getProjectClone).toHaveBeenCalledTimes(1);
});
it("reuses the idempotency key after an uncertain start response", async () => {
  const view = setup();
  view.cloneProject.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => {
    await view.result.start(input);
  });
  expect(view.result.error).toBe("Connection lost");
  await act(async () => {
    await view.result.start(input);
  });
  expect(view.cloneProject.mock.calls[0]![0].idempotencyKey).toBe(
    view.cloneProject.mock.calls[1]![0].idempotencyKey,
  );
});
it("reports a late start across A to B to A as orphaned without publishing it", async () => {
  const view = setup();
  let resolve!: (value: RemoteRunnerCloneJob) => void;
  view.cloneProject.mockReturnValue(
    new Promise<RemoteRunnerCloneJob>((yes) => {
      resolve = yes;
    }),
  );
  let pending!: Promise<RemoteProjectCloneStart>;
  act(() => {
    pending = view.result.start(input);
  });
  view.render("b");
  view.render("a");
  let settled!: RemoteProjectCloneStart;
  await act(async () => {
    resolve(job);
    settled = await pending;
  });
  expect(settled).toEqual({ status: "orphaned", job });
  expect(view.result.job).toBeNull();
  expect(view.getProjectClone).not.toHaveBeenCalled();
});
it("does not let a late poll undo cancellation", async () => {
  const view = setup();
  let resolve!: (value: RemoteRunnerCloneJob) => void;
  view.getProjectClone.mockReturnValue(
    new Promise<RemoteRunnerCloneJob>((yes) => {
      resolve = yes;
    }),
  );
  await act(async () => {
    await view.result.start(input);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  await act(async () => {
    await view.result.cancel();
  });
  await act(async () => {
    resolve(job);
  });
  expect(view.result.job?.status).toBe("cancelled");
});
it("retries polling after a temporary connection failure", async () => {
  const view = setup();
  view.getProjectClone.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await view.result.start(input);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.result.error).toBe("offline");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(view.result.error).toBeNull();
});
it("preserves an uncertain retry key even after an earlier terminal job", async () => {
  const view = setup();
  view.cloneProject.mockResolvedValueOnce({ ...job, status: "cancelled" });
  await act(async () => {
    await view.result.start(input);
  });
  view.cloneProject.mockRejectedValueOnce(new Error("response lost"));
  await act(async () => {
    await view.result.start(input);
  });
  await act(async () => {
    await view.result.start(input);
  });
  expect(view.cloneProject.mock.calls[0]![0].idempotencyKey).not.toBe(
    view.cloneProject.mock.calls[1]![0].idempotencyKey,
  );
  expect(view.cloneProject.mock.calls[1]![0].idempotencyKey).toBe(
    view.cloneProject.mock.calls[2]![0].idempotencyKey,
  );
});
it("does not start another poll while cancellation is pending", async () => {
  const view = setup();
  let resolve!: (value: RemoteRunnerCloneJob) => void;
  view.cancelProjectClone.mockReturnValue(
    new Promise<RemoteRunnerCloneJob>((yes) => {
      resolve = yes;
    }),
  );
  await act(async () => {
    await view.result.start(input);
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = view.result.cancel();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(view.getProjectClone).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ ...job, status: "cancelled" });
    await pending;
  });
});

it("reports the requested folder name and clears it when the owner changes", async () => {
  const view = setup();
  expect(view.result.requestedName).toBeNull();
  await act(async () => {
    await view.result.start(input);
  });
  expect(view.result.requestedName).toBe("project");
  view.render("b");
  expect(view.result.requestedName).toBeNull();
});

it("returns a typed start outcome for success, failure and refusal", async () => {
  const view = setup();
  const started = await act(async () => view.result.start(input));
  expect(started).toEqual({ status: "started", job });
  const refused = await act(async () => view.result.start(input));
  expect(refused).toEqual({ status: "ignored" });
  await act(async () => {
    await view.result.cancel();
  });
  view.cloneProject.mockRejectedValueOnce(new Error("Connection lost"));
  const failed = await act(async () => view.result.start(input));
  expect(failed).toEqual({ status: "failed", error: "Connection lost" });
});

it("resumes a tracked clone and keeps polling it", async () => {
  const view = setup();
  await act(async () => {
    await view.result.resume("clone");
  });
  expect(view.getProjectClone).toHaveBeenCalledWith({ serverId: "a", cloneId: "clone" });
  expect(view.result.job).toEqual(job);
  view.getProjectClone.mockResolvedValue({ ...job, status: "succeeded" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.result.job?.status).toBe("succeeded");
});

it("refuses a resumed clone whose identity does not match", async () => {
  const view = setup();
  view.getProjectClone.mockResolvedValueOnce({ ...job, id: "other" });
  await act(async () => {
    await view.result.resume("clone");
  });
  expect(view.result.job).toBeNull();
  expect(view.result.error).toBe("The server returned a different clone operation.");
});

it("ignores a resume once a clone is already owned", async () => {
  const view = setup();
  await act(async () => {
    await view.result.start(input);
  });
  await act(async () => {
    await view.result.resume("other");
  });
  expect(view.getProjectClone).not.toHaveBeenCalledWith({ serverId: "a", cloneId: "other" });
});

it("dismisses only a settled clone", async () => {
  const view = setup();
  view.cloneProject.mockResolvedValueOnce({ ...job, status: "running" });
  await act(async () => {
    await view.result.start(input);
  });
  act(() => {
    view.result.dismiss();
  });
  expect(view.result.job).not.toBeNull();
  await act(async () => {
    await view.result.cancel();
  });
  act(() => {
    view.result.dismiss();
  });
  expect(view.result.job).toBeNull();
  expect(view.result.requestedName).toBeNull();
});

it("ignores start, resume and cancel while no gateway is connected", async () => {
  const view = setup();
  view.render("a", false);
  const started = await act(async () => view.result.start(input));
  expect(started).toEqual({ status: "ignored" });
  await act(async () => {
    await view.result.resume("clone");
    await view.result.cancel();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(view.cloneProject).not.toHaveBeenCalled();
  expect(view.getProjectClone).not.toHaveBeenCalled();
  expect(view.cancelProjectClone).not.toHaveBeenCalled();
  expect(view.result.job).toBeNull();
  expect(view.result.error).toBeNull();
  expect(view.result.pending).toBe(false);
  expect(view.result.busy).toBe(false);
});

it("stops polling and drops the late poll when the gateway disappears", async () => {
  const view = setup();
  let resolve!: (value: RemoteRunnerCloneJob) => void;
  view.getProjectClone.mockReturnValue(
    new Promise<RemoteRunnerCloneJob>((yes) => {
      resolve = yes;
    }),
  );
  await act(async () => {
    await view.result.start(input);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.getProjectClone).toHaveBeenCalledTimes(1);
  view.render("a", false);
  await act(async () => {
    resolve({ ...job, status: "succeeded" });
  });
  expect(view.result.job).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(view.getProjectClone).toHaveBeenCalledTimes(1);
  expect(view.result.busy).toBe(false);
});

it("preserves an active clone and its polling schedule across same-owner renders", async () => {
  const view = setup();
  await act(async () => {
    await view.result.start(input);
    await vi.advanceTimersByTimeAsync(500);
  });
  view.render("a");
  expect(view.result.job).toEqual(job);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(view.cloneProject).toHaveBeenCalledTimes(1);
  expect(view.getProjectClone).toHaveBeenCalledTimes(1);
});
