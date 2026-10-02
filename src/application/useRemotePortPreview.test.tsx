// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemotePortPreviewPort } from "../domain/remotePortPreview";
import type {
  RemotePortForward,
  RemotePortListing,
  RemotePortListRequest,
  RemotePortOpenResponse,
} from "../domain/remotePortPreviewWire";
import {
  useRemotePortPreview,
  type RemotePortOpenResult,
  type RemotePortPreviewInput,
  type RemotePortPreviewSurface,
} from "./useRemotePortPreview";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const TASK_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TASK_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const targetA = {
  serverId: "linux",
  runnerId: "runner-1",
  scope: { kind: "task", taskId: TASK_A },
} as const;
const targetB = { ...targetA, scope: { kind: "task", taskId: TASK_B } } as const;
const ownerA = { ownerId: "workspace-a", ownerGeneration: 1 };

function listingOf(
  ports: readonly number[],
  forward: RemotePortForward | null = null,
): RemotePortListing {
  return {
    ports: ports.map((port) => ({
      port,
      address: "loopback-v4",
      source: "agent",
      process: "node",
      forward,
    })),
    truncated: false,
    scannedAt: "2026-10-02T09:15:00.000Z",
  };
}

function fakePort(auto: boolean) {
  const lists: { request: RemotePortListRequest; pending: Deferred<RemotePortListing> }[] = [];
  let current = listingOf([3000]);
  const list = vi.fn((request: RemotePortListRequest) => {
    const pending = deferred<RemotePortListing>();
    lists.push({ request, pending });
    if (auto) pending.resolve(current);
    return pending.promise;
  });
  const open = vi.fn<RemotePortPreviewPort["open"]>(async () => ({ localPort: 43000 }));
  const close = vi.fn<RemotePortPreviewPort["close"]>(async () => undefined);
  const releaseOwner = vi.fn<RemotePortPreviewPort["releaseOwner"]>(async () => undefined);
  const port: RemotePortPreviewPort = { list, open, close, releaseOwner };
  return {
    port,
    list,
    open,
    close,
    lists,
    serve(next: RemotePortListing) {
      current = next;
    },
  };
}

async function mount(initial: RemotePortPreviewInput, strict = false) {
  let input = initial;
  let surface!: RemotePortPreviewSurface;
  const root = createRoot(document.createElement("div"));
  function Host() {
    surface = useRemotePortPreview(input);
    return null;
  }
  const render = () =>
    root.render(
      strict ? (
        <StrictMode>
          <Host />
        </StrictMode>
      ) : (
        <Host />
      ),
    );
  await act(async () => render());
  return {
    surface: () => surface,
    async update(next: Partial<RemotePortPreviewInput>) {
      input = { ...input, ...next };
      await act(async () => render());
    },
    async unmount() {
      await act(async () => root.unmount());
    },
  };
}

const inputFor = (port: RemotePortPreviewPort): RemotePortPreviewInput => ({
  port,
  enabled: true,
  owner: ownerA,
  target: targetA,
  activity: { turnActive: false, terminalOpen: false },
});
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const settle = (run: () => void) => act(async () => run());
const ports = (h: { surface(): RemotePortPreviewSurface }) => h.surface().ports.map((p) => p.port);

let hasFocus: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useRemotePortPreview idle gating", () => {
  it.each([
    ["disabled", { enabled: false }],
    ["no owner", { owner: null }],
    ["no target", { target: null }],
  ] as const)("never calls the port when %s", async (_name, override) => {
    const fake = fakePort(true);
    const h = await mount({ ...inputFor(fake.port), ...override });
    await advance(120_000);
    expect(fake.list).not.toHaveBeenCalled();
    expect(h.surface()).toMatchObject({ status: "idle", ports: [], error: null });
    expect(await h.surface().open(3000)).toEqual({ kind: "stale" });
    await h.unmount();
  });

  it("clears ports and goes idle when the capability disappears", async () => {
    const fake = fakePort(true);
    const h = await mount(inputFor(fake.port));
    expect(h.surface().status).toBe("ready");
    expect(ports(h)).toEqual([3000]);
    await h.update({ enabled: false });
    expect(h.surface()).toMatchObject({ status: "idle", ports: [] });
    await advance(120_000);
    expect(fake.list).toHaveBeenCalledTimes(1);
    await h.unmount();
  });

  it("works under StrictMode", async () => {
    const fake = fakePort(true);
    const h = await mount(inputFor(fake.port), true);
    expect(h.surface().status).toBe("ready");
    expect(ports(h)).toEqual([3000]);
    await h.unmount();
  });
});

describe("useRemotePortPreview cadence", () => {
  it("polls every 5 s while a turn runs and the window is focused", async () => {
    const fake = fakePort(true);
    const h = await mount({
      ...inputFor(fake.port),
      activity: { turnActive: true, terminalOpen: false },
    });
    expect(fake.list).toHaveBeenCalledTimes(1);
    await advance(4_999);
    expect(fake.list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fake.list).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(fake.list).toHaveBeenCalledTimes(3);
    await h.unmount();
  });

  it("polls every 5 s while the server terminal is open", async () => {
    const fake = fakePort(true);
    const h = await mount({
      ...inputFor(fake.port),
      activity: { turnActive: false, terminalOpen: true },
    });
    await advance(5_000);
    expect(fake.list).toHaveBeenCalledTimes(2);
    await h.unmount();
  });

  it("polls every 30 s when nothing runs", async () => {
    const fake = fakePort(true);
    const h = await mount(inputFor(fake.port));
    await advance(29_999);
    expect(fake.list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fake.list).toHaveBeenCalledTimes(2);
    await h.unmount();
  });

  it("polls every 30 s when blurred even with a running turn", async () => {
    hasFocus.mockReturnValue(false);
    const fake = fakePort(true);
    const h = await mount({
      ...inputFor(fake.port),
      activity: { turnActive: true, terminalOpen: false },
    });
    await advance(29_999);
    expect(fake.list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fake.list).toHaveBeenCalledTimes(2);
    await h.unmount();
  });

  it("slows down on blur and refreshes immediately on focus", async () => {
    const fake = fakePort(true);
    const h = await mount({
      ...inputFor(fake.port),
      activity: { turnActive: true, terminalOpen: false },
    });
    await settle(() => window.dispatchEvent(new Event("blur")));
    await advance(29_999);
    expect(fake.list).toHaveBeenCalledTimes(1);
    await settle(() => window.dispatchEvent(new Event("focus")));
    expect(fake.list).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(fake.list).toHaveBeenCalledTimes(3);
    await h.unmount();
  });

  it("speeds up when a turn starts", async () => {
    const fake = fakePort(true);
    const h = await mount(inputFor(fake.port));
    await h.update({ activity: { turnActive: true, terminalOpen: false } });
    await advance(5_000);
    expect(fake.list).toHaveBeenCalledTimes(2);
    await h.unmount();
  });

  it("never overlaps list requests and coalesces refreshes", async () => {
    const fake = fakePort(false);
    const h = await mount({
      ...inputFor(fake.port),
      activity: { turnActive: true, terminalOpen: false },
    });
    await settle(() => {
      h.surface().refresh();
      h.surface().refresh();
      h.surface().refresh();
    });
    await settle(() => window.dispatchEvent(new Event("focus")));
    await advance(60_000);
    expect(fake.list).toHaveBeenCalledTimes(1);
    await settle(() => fake.lists[0].pending.resolve(listingOf([3000])));
    expect(fake.list).toHaveBeenCalledTimes(2);
    await settle(() => fake.lists[1].pending.resolve(listingOf([3000])));
    expect(fake.list).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(fake.list).toHaveBeenCalledTimes(3);
    await h.unmount();
  });

  it("reports list errors and keeps ports of the same key only", async () => {
    const fake = fakePort(false);
    const h = await mount(inputFor(fake.port));
    await settle(() => fake.lists[0].pending.resolve(listingOf([3000])));
    await settle(() => h.surface().refresh());
    await settle(() => fake.lists[1].pending.reject("Server disconnected."));
    expect(h.surface()).toMatchObject({ status: "error", error: "Server disconnected." });
    expect(ports(h)).toEqual([3000]);
    await h.update({ target: targetB });
    expect(h.surface()).toMatchObject({ status: "loading", ports: [], error: null });
    await settle(() => fake.lists[2].pending.reject({ secret: true }));
    expect(h.surface()).toMatchObject({
      status: "error",
      ports: [],
      error: "The server could not complete this port operation.",
    });
    await h.unmount();
  });
});

describe("useRemotePortPreview stale results", () => {
  it("drops a slow result of the previous thread after switching A -> B", async () => {
    const fake = fakePort(false);
    const h = await mount(inputFor(fake.port));
    await settle(() => fake.lists[0].pending.resolve(listingOf([3000])));
    await settle(() => h.surface().refresh());
    await h.update({ target: targetB });
    expect(h.surface()).toMatchObject({ status: "loading", ports: [] });
    expect(fake.lists[2].request.scope).toEqual(targetB.scope);
    await settle(() => fake.lists[1].pending.resolve(listingOf([3001])));
    expect(h.surface()).toMatchObject({ status: "loading", ports: [] });
    await settle(() => fake.lists[2].pending.resolve(listingOf([5173])));
    expect(ports(h)).toEqual([5173]);
    await h.unmount();
  });

  it("drops the first A result after A -> B -> A reissued the request", async () => {
    const fake = fakePort(false);
    const h = await mount(inputFor(fake.port));
    await h.update({ target: targetB });
    await h.update({ target: targetA });
    expect(fake.list).toHaveBeenCalledTimes(3);
    expect(fake.lists[2].request).toEqual(fake.lists[0].request);
    await settle(() => fake.lists[0].pending.resolve(listingOf([3000])));
    expect(h.surface()).toMatchObject({ status: "loading", ports: [] });
    await settle(() => fake.lists[1].pending.resolve(listingOf([5173])));
    expect(h.surface()).toMatchObject({ status: "loading", ports: [] });
    await settle(() => fake.lists[2].pending.resolve(listingOf([4000])));
    expect(ports(h)).toEqual([4000]);
    await h.unmount();
  });

  it("drops an in-flight result when the owner generation changes", async () => {
    const fake = fakePort(false);
    const h = await mount(inputFor(fake.port));
    await h.update({ owner: { ...ownerA, ownerGeneration: 2 } });
    expect(fake.lists[1].request.ownerGeneration).toBe(2);
    await settle(() => fake.lists[0].pending.resolve(listingOf([3000])));
    expect(h.surface()).toMatchObject({ status: "loading", ports: [] });
    await settle(() => fake.lists[1].pending.resolve(listingOf([4000])));
    expect(ports(h)).toEqual([4000]);
    await h.unmount();
  });

  it("never updates state after unmount and leaves no timers", async () => {
    const fake = fakePort(false);
    const h = await mount(inputFor(fake.port));
    const surface = h.surface();
    await h.unmount();
    await settle(() => fake.lists[0].pending.resolve(listingOf([3000])));
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(fake.list).toHaveBeenCalledTimes(1);
    expect(await surface.open(3000)).toEqual({ kind: "stale" });
    await surface.close(3000);
    expect(fake.open).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
  });
});

describe("useRemotePortPreview forwarding", () => {
  it("shows opening locally and the refreshed open forward on success", async () => {
    const fake = fakePort(true);
    const response = deferred<RemotePortOpenResponse>();
    fake.open.mockReturnValueOnce(response.promise);
    const h = await mount(inputFor(fake.port));
    let result!: Promise<RemotePortOpenResult>;
    await settle(() => {
      result = h.surface().open(3000, { scheme: "https", path: "/app?x=1" });
    });
    expect(h.surface().ports[0].forward).toEqual({ kind: "opening" });
    expect(fake.open).toHaveBeenCalledWith({
      serverId: "linux",
      runnerId: "runner-1",
      ownerId: "workspace-a",
      ownerGeneration: 1,
      scope: targetA.scope,
      port: 3000,
      scheme: "https",
      path: "/app?x=1",
    });
    fake.serve(listingOf([3000], { localPort: 43000, state: "open" }));
    await settle(() => response.resolve({ localPort: 43000 }));
    expect(await result).toEqual({ kind: "opened", localPort: 43000 });
    expect(fake.list).toHaveBeenCalledTimes(2);
    expect(h.surface().ports[0].forward).toEqual({ kind: "open", localPort: 43000 });
    await h.unmount();
  });

  it("shows the failure reason until close clears it", async () => {
    const fake = fakePort(true);
    fake.open.mockRejectedValueOnce(new Error("Port 3000 is not listening on the server."));
    const h = await mount(inputFor(fake.port));
    let result!: RemotePortOpenResult;
    await act(async () => {
      result = await h.surface().open(3000);
    });
    expect(result).toEqual({
      kind: "failed",
      reason: "Port 3000 is not listening on the server.",
    });
    expect(fake.open.mock.calls[0][0]).toMatchObject({ scheme: "http", path: "/" });
    expect(h.surface().ports[0].forward).toEqual({
      kind: "failed",
      reason: "Port 3000 is not listening on the server.",
    });
    await act(async () => h.surface().close(3000));
    expect(fake.close).toHaveBeenCalledWith({
      serverId: "linux",
      ownerId: "workspace-a",
      ownerGeneration: 1,
      scope: targetA.scope,
      port: 3000,
    });
    expect(fake.list).toHaveBeenCalledTimes(2);
    expect(h.surface().ports[0].forward).toEqual({ kind: "none" });
    await h.unmount();
  });

  it("returns stale for an open that settles after the thread changed", async () => {
    const fake = fakePort(true);
    const response = deferred<RemotePortOpenResponse>();
    fake.open.mockReturnValueOnce(response.promise);
    const h = await mount(inputFor(fake.port));
    let result!: Promise<RemotePortOpenResult>;
    await settle(() => {
      result = h.surface().open(3000);
    });
    await h.update({ target: targetB });
    const listsBefore = fake.list.mock.calls.length;
    await settle(() => response.resolve({ localPort: 43000 }));
    expect(await result).toEqual({ kind: "stale" });
    expect(fake.list).toHaveBeenCalledTimes(listsBefore);
    expect(h.surface().ports[0].forward).toEqual({ kind: "none" });
    await h.unmount();
  });

  it("refreshes the listing after closing a forward", async () => {
    const fake = fakePort(true);
    fake.serve(listingOf([3000], { localPort: 43000, state: "open" }));
    const h = await mount(inputFor(fake.port));
    expect(h.surface().ports[0].forward).toEqual({ kind: "open", localPort: 43000 });
    fake.serve(listingOf([3000]));
    await act(async () => h.surface().close(3000));
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.list).toHaveBeenCalledTimes(2);
    expect(h.surface().ports[0].forward).toEqual({ kind: "none" });
    await h.unmount();
  });
});
