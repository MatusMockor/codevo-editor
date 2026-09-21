// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalProjectCloneSnapshot } from "../domain/localProjectClone";
import type { LocalProjectCloneGateway } from "./ports/localProjectCloneGateway";
import { useLocalProjectClone, type LocalProjectCloneSession } from "./useLocalProjectClone";

const input = { url: "https://github.com/team/repo.git", name: "repo", parentPath: "/projects" };
const running = (
  cloneId: string,
): Extract<LocalProjectCloneSnapshot, { status: "running" | "completed" }> => ({
  cloneId,
  status: "running",
  path: "/projects/repo",
  error: null,
});
function setup(start?: LocalProjectCloneGateway["start"], session?: LocalProjectCloneSession) {
  const gateway: LocalProjectCloneGateway = {
    start: vi.fn(start ?? (async (request) => running(request.idempotencyKey))),
    get: vi.fn(),
    cancel: vi.fn(),
  };
  const onStarted = vi.fn();
  const onReady = vi.fn();
  const result = { current: null as unknown as ReturnType<typeof useLocalProjectClone> };
  function Harness({
    identity,
    selectedGateway = gateway,
  }: {
    identity: string;
    selectedGateway?: LocalProjectCloneGateway;
  }) {
    result.current = useLocalProjectClone({
      gateway: selectedGateway,
      session,
      selectionIdentity: identity,
      onStarted,
      onReady,
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ root, host });
  const rerender = ({
    identity,
    selectedGateway,
    mountKey = "initial",
  }: {
    identity: string;
    selectedGateway?: LocalProjectCloneGateway;
    mountKey?: string;
  }) =>
    act(() =>
      root.render(<Harness key={mountKey} identity={identity} selectedGateway={selectedGateway} />),
    );
  rerender({ identity: "a" });
  const hook = {
    result,
    detach: () => act(() => root.render(null)),
    rerender,
    unmount: () => {
      act(() => root.unmount());
      roots.splice(
        roots.findIndex((item) => item.root === root),
        1,
      );
      host.remove();
    },
  };
  return { ...hook, gateway, onStarted, onReady };
}
const roots: { root: Root; host: HTMLElement }[] = [];
beforeEach(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
});
describe("local clone ownership", () => {
  it("rejects retained idle actions once the operation is running", async () => {
    const s = setup();
    const idle = s.result.current;
    await act(async () => {
      await idle.start(input);
    });
    await act(async () => {
      idle.dismiss();
      await idle.start(input);
    });
    expect(s.gateway.start).toHaveBeenCalledTimes(1);
    expect(s.result.current.job?.status).toBe("running");
  });
  it("does not publish an old completion into a replacement gateway", async () => {
    let resolve!: (value: LocalProjectCloneSnapshot) => void;
    let id = "";
    const s = setup((request) => {
      id = request.idempotencyKey;
      return new Promise((r) => {
        resolve = r;
      });
    });
    let pending!: Promise<void>;
    act(() => {
      pending = s.result.current.start(input);
    });
    const replacement = { ...s.gateway };
    await act(async () => {
      resolve({ ...running(id), status: "completed" });
      await pending;
      s.rerender({ identity: "a", selectedGateway: replacement });
    });
    expect(s.result.current.job).toBeNull();
    expect(s.onReady).not.toHaveBeenCalled();
  });

  it("keeps the clone across A → B → A without stealing selection", async () => {
    let resolve!: (value: LocalProjectCloneSnapshot) => void;
    let id = "";
    const s = setup((request) => {
      id = request.idempotencyKey;
      return new Promise((r) => {
        resolve = r;
      });
    });
    let pending!: Promise<void>;
    act(() => {
      pending = s.result.current.start(input);
    });
    s.rerender({ identity: "b" });
    s.rerender({ identity: "a" });
    await act(async () => {
      resolve(running(id));
      await pending;
    });
    expect(s.onStarted).toHaveBeenCalledWith(id, "repo", { select: false });
    expect(s.result.current.job?.status).toBe("running");
    expect(s.gateway.start).toHaveBeenCalledTimes(1);
  });
  it("rejects a foreign start receipt", async () => {
    const s = setup(async () => running("00000000-0000-0000-0000-000000000000"));
    await act(async () => {
      await s.result.current.start(input);
    });
    expect(s.result.current.error).toMatch(/another operation/);
    expect(s.onStarted).not.toHaveBeenCalled();
  });
  it("reuses uncertain start identity and gives an explicit retry a fresh identity after failure", async () => {
    let attempts = 0;
    const s = setup(async (request) => {
      if (++attempts === 1) throw new Error("offline");
      return {
        cloneId: request.idempotencyKey,
        status: "failed",
        path: null,
        error: "clone failed",
      };
    });
    await act(async () => {
      await s.result.current.start(input);
    });
    await act(async () => {
      s.result.current.retry();
    });
    expect(s.gateway.start).toHaveBeenCalledTimes(2);
    await act(async () => {
      s.result.current.retry();
    });
    const calls = vi.mocked(s.gateway.start).mock.calls;
    expect(calls[0][0].idempotencyKey).toBe(calls[1][0].idempotencyKey);
    expect(calls[2][0].idempotencyKey).not.toBe(calls[1][0].idempotencyKey);
  });
  it("publishes completion once and stops polling", async () => {
    vi.useFakeTimers();
    const s = setup();
    vi.mocked(s.gateway.get).mockImplementation(async ({ cloneId }) => ({
      ...running(cloneId),
      status: "completed",
    }));
    await act(async () => {
      await s.result.current.start(input);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(s.onReady).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(s.gateway.get).toHaveBeenCalledTimes(1);
  });
  it("discards late polling results after cancellation", async () => {
    vi.useFakeTimers();
    const s = setup();
    let resolve!: (value: LocalProjectCloneSnapshot) => void;
    vi.mocked(s.gateway.get).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    vi.mocked(s.gateway.cancel).mockImplementation(async ({ cloneId }) => ({
      cloneId,
      status: "cancelled",
      path: null,
      error: null,
    }));
    await act(async () => {
      await s.result.current.start(input);
    });
    const id = s.result.current.job!.cloneId;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await s.result.current.cancel();
    });
    await act(async () => {
      resolve({ ...running(id), status: "completed" });
    });
    expect(s.result.current.job?.status).toBe("cancelled");
    expect(s.onReady).not.toHaveBeenCalled();
  });
  it("does not notify after unmount and rejects unsafe inputs before invoking gateway", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.start({ ...input, name: "../outside" });
    });
    expect(s.gateway.start).not.toHaveBeenCalled();
    s.unmount();
    await s.result.current.start(input);
    expect(s.gateway.start).not.toHaveBeenCalled();
  });
});

describe("Screen-owned clone lifetime", () => {
  it("resumes a running operation across keyed workspace remount and delivers completion to the new leaf", async () => {
    vi.useFakeTimers();
    const session: LocalProjectCloneSession = { current: null };
    const s = setup(undefined, session);
    await act(async () => s.result.current.start(input));
    const id = s.result.current.job!.cloneId;
    vi.mocked(s.gateway.get).mockResolvedValue({ ...running(id), status: "completed" });
    s.onStarted.mockClear();
    s.rerender({ identity: "b", mountKey: "b" });
    expect(s.result.current.job?.cloneId).toBe(id);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(s.onReady).toHaveBeenCalledWith(id, "/projects/repo");
    expect(s.onStarted).toHaveBeenCalledWith(id, "repo", { select: false });
    s.rerender({ identity: "a", mountKey: "a-return" });
    expect(s.result.current.job?.status).toBe("completed");
    expect(s.gateway.start).toHaveBeenCalledTimes(1);
  });

  it("replays the same idempotent start after remount before acknowledgement without selecting", async () => {
    const session: LocalProjectCloneSession = { current: null };
    const acknowledgements: Array<(value: LocalProjectCloneSnapshot) => void> = [];
    const s = setup(() => new Promise((resolve) => acknowledgements.push(resolve)), session);
    act(() => {
      void s.result.current.start(input);
    });
    s.rerender({ identity: "b", mountKey: "b" });
    const requests = vi.mocked(s.gateway.start).mock.calls;
    expect(requests).toHaveLength(2);
    expect(requests[1][0]).toEqual(requests[0][0]);
    const id = requests[0][0].idempotencyKey;
    await act(async () => acknowledgements[1]({ ...running(id), status: "completed" }));
    expect(s.onStarted).toHaveBeenCalledWith(id, "repo", { select: false });
    expect(s.onReady).toHaveBeenCalledWith(id, "/projects/repo");
    await act(async () => acknowledgements[0](running(id)));
    expect(s.result.current.job?.status).toBe("completed");
    expect(session.current?.job?.status).toBe("completed");
  });

  it("revokes the retained session on gateway replacement and ignores its late acknowledgement", async () => {
    const session: LocalProjectCloneSession = { current: null };
    let resolve!: (value: LocalProjectCloneSnapshot) => void;
    const s = setup(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
      session,
    );
    act(() => {
      void s.result.current.start(input);
    });
    const id = vi.mocked(s.gateway.start).mock.calls[0][0].idempotencyKey;
    const replacement = { ...s.gateway, start: vi.fn(), get: vi.fn() };
    s.rerender({ identity: "b", mountKey: "b", selectedGateway: replacement });
    await act(async () => resolve(running(id)));
    expect(session.current).toBeNull();
    expect(s.result.current.job).toBeNull();
    expect(s.onStarted).not.toHaveBeenCalled();
    expect(s.onReady).not.toHaveBeenCalled();
  });
  it("does not regress completion when multiple remount replay acknowledgements arrive out of order", async () => {
    const session: LocalProjectCloneSession = { current: null };
    const pending: Array<(job: LocalProjectCloneSnapshot) => void> = [];
    const s = setup(() => new Promise((resolve) => pending.push(resolve)), session);
    act(() => {
      void s.result.current.start(input);
    });
    const id = vi.mocked(s.gateway.start).mock.calls[0][0].idempotencyKey;
    s.rerender({ identity: "b", mountKey: "b" });
    s.rerender({ identity: "c", mountKey: "c" });
    await act(async () => pending[2]({ ...running(id), status: "completed" }));
    await act(async () => pending[1](running(id)));
    await act(async () => pending[0](running(id)));
    expect(session.current?.job?.status).toBe("completed");
    expect(s.result.current.job?.status).toBe("completed");
  });

  it("uses retained completion when the active replay returns an older running acknowledgement", async () => {
    const session: LocalProjectCloneSession = { current: null };
    const pending: Array<(job: LocalProjectCloneSnapshot) => void> = [];
    const s = setup(() => new Promise((resolve) => pending.push(resolve)), session);
    act(() => {
      void s.result.current.start(input);
    });
    const id = vi.mocked(s.gateway.start).mock.calls[0][0].idempotencyKey;
    s.rerender({ identity: "b", mountKey: "b" });
    await act(async () => pending[0]({ ...running(id), status: "completed" }));
    await act(async () => pending[1](running(id)));
    expect(session.current?.job?.status).toBe("completed");
    expect(s.result.current.job?.status).toBe("completed");
    expect(s.onReady).toHaveBeenCalledWith(id, "/projects/repo");
  });
  it("restores metadata when acknowledgement settles between leaf unmount and next mount", async () => {
    const session: LocalProjectCloneSession = { current: null };
    let settle!: (job: LocalProjectCloneSnapshot) => void;
    const s = setup(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      session,
    );
    act(() => {
      void s.result.current.start(input);
    });
    const id = vi.mocked(s.gateway.start).mock.calls[0][0].idempotencyKey;
    s.detach();
    await act(async () => settle({ ...running(id), status: "completed" }));
    expect(s.onStarted).not.toHaveBeenCalled();
    s.rerender({ identity: "b", mountKey: "b" });
    expect(s.onStarted).toHaveBeenCalledWith(id, "repo", { select: false });
    expect(s.onReady).toHaveBeenCalledWith(id, "/projects/repo");
    expect(s.gateway.start).toHaveBeenCalledTimes(1);
  });
});
