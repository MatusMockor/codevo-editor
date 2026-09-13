// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../domain/remoteRunner";
import { useRemoteProjectClone } from "./useRemoteProjectClone";
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
  function Harness({ server }: { server: string }) {
    result = useRemoteProjectClone({ gateway, serverId: server, workspaceOwner: "workspace" });
    return null;
  }
  const render = (server: string) => act(() => root.render(<Harness server={server} />));
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
it("ignores a late start across A to B to A", async () => {
  const view = setup();
  let resolve!: (value: RemoteRunnerCloneJob) => void;
  view.cloneProject.mockReturnValue(
    new Promise<RemoteRunnerCloneJob>((yes) => {
      resolve = yes;
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.start(input);
  });
  view.render("b");
  view.render("a");
  await act(async () => {
    resolve(job);
    await pending;
  });
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
  let pending!: Promise<void>;
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
