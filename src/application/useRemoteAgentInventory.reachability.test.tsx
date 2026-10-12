// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerServer } from "../domain/remoteRunner";
import {
  MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH,
  remoteRunnerDisconnected,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
  REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE,
} from "../domain/remoteRunnerReachability";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../test/remoteRunnerOutageTestSupport";
import {
  useRemoteAgentInventory,
  type RemoteAgentInventorySurface,
} from "./useRemoteAgentInventory";

interface HarnessOptions {
  readonly workspaceOwner: string;
  readonly servers: readonly RemoteRunnerServer[];
}

describe("remote inventory reachability ownership", () => {
  let root: Root;
  let surface: RemoteAgentInventorySurface;
  let options: HarnessOptions;
  let fleet: ReturnType<typeof fakeRunnerFleetGateway>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function Harness() {
    surface = useRemoteAgentInventory({
      gateway: fleet.gateway,
      servers: options.servers,
      workspaceOwner: options.workspaceOwner,
      selectedThreadId: null,
    });
    return null;
  }

  async function render(patch: Partial<HarnessOptions> = {}): Promise<void> {
    options = { ...options, ...patch };
    await act(async () => {
      root.render(createElement(Harness));
    });
  }

  async function advance(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  async function deferNextDescriptor(): Promise<{ answer(): void; fail(error: Error): void }> {
    const descriptor = await fleet.spies.getRunner({ serverId: "linux" });
    let answer: () => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    fleet.spies.getRunner.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          answer = () => resolve(descriptor);
          fail = reject;
        }),
    );
    return { answer: () => answer(), fail: (error) => fail(error) };
  }

  async function settle(work: () => void): Promise<void> {
    await act(async () => {
      work();
      await vi.advanceTimersByTimeAsync(10);
    });
  }

  it("drops a late failed refresh of the previous workspace owner", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    const first = await deferNextDescriptor();
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    expect(surface.reachability.size).toBe(0);

    await render({ workspaceOwner: "B" });
    await advance(10);
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);

    await settle(() => first.fail(new Error("The runner is unreachable.")));
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
    expect(surface.snapshots.find((entry) => entry.serverId === "linux")?.error).toBeNull();

    const returning = await deferNextDescriptor();
    await render({ workspaceOwner: "A" });
    expect(surface.reachability.size).toBe(0);
    await settle(() => returning.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("does not carry an outage seen by one owner into the next owner", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    linux.goDown();
    await advance(300);
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);

    linux.up = true;
    const next = await deferNextDescriptor();
    await render({ workspaceOwner: "B" });
    expect(surface.reachability.size).toBe(0);
    await settle(() => next.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);

    const returning = await deferNextDescriptor();
    await render({ workspaceOwner: "A" });
    expect(surface.reachability.size).toBe(0);
    await settle(() => returning.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("treats a changed endpoint as reconnecting until it has been refreshed", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);

    const moved = await deferNextDescriptor();
    await render({ servers: [{ ...linux.server, port: 2222 }] });
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);

    await settle(() => moved.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("reports a server the native layer no longer holds as disconnected", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);

    linux.failure = "Server is not connected";
    linux.goDown();
    await advance(300);

    expect(surface.reachability.get("linux")).toBe(remoteRunnerDisconnected("serverDisconnected"));
  });

  it("publishes one stable map while the meaning is unchanged", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    linux.goDown();
    await advance(300);
    const reconnecting = surface.reachability;

    await render();
    expect(surface.reachability).toBe(reconnecting);
    await advance(2_100);
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
  });

  describe("a refresh that fails after the descriptor answered", () => {
    async function mountReachable(): Promise<FakeRunnerHost> {
      const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
      fleet = fakeRunnerFleetGateway([linux]);
      options = { workspaceOwner: "A", servers: [linux.server] };
      await render();
      await advance(10);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      return linux;
    }

    function failNextProjectListing(before: () => void): void {
      fleet.spies.listProjects.mockImplementationOnce(() => {
        before();
        return Promise.reject(new Error("The connection closed during the request."));
      });
    }

    it("is reconnecting when the follow-up descriptor request fails", async () => {
      const linux = await mountReachable();
      failNextProjectListing(() => {
        linux.up = false;
      });
      const calls = fleet.spies.getRunner.mock.calls.length;
      linux.emit("changed");
      await advance(300);

      expect(fleet.spies.getRunner.mock.calls.length).toBe(calls + 2);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.get("linux")).toBe("The runner is unreachable.");
    });

    it("stays reachable with its error when the follow-up answers as the same runner", async () => {
      const linux = await mountReachable();
      failNextProjectListing(() => undefined);
      linux.emit("changed");
      await advance(300);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      expect(surface.reconnectingReasons.size).toBe(0);
      expect(surface.snapshots.find((entry) => entry.serverId === "linux")?.error).toBe(
        "The connection closed during the request.",
      );
    });

    it("stays reachable when the server was reconnected within the same refresh pass", async () => {
      const linux = await mountReachable();
      fleet.spies.listProjects.mockImplementationOnce(() =>
        Promise.reject(REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE),
      );
      linux.emit("changed");
      await advance(300);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      expect(surface.reconnectingReasons.size).toBe(0);
      const snapshot = surface.snapshots.find((entry) => entry.serverId === "linux");
      expect(snapshot?.error).toBe(REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE);
    });

    it("is a replaced runner when the follow-up answers as another runner", async () => {
      const linux = await mountReachable();
      failNextProjectListing(() => {
        linux.runnerId = "replacement";
      });
      linux.emit("changed");
      await advance(300);

      expect(surface.reachability.get("linux")).toBe(remoteRunnerDisconnected("runnerReplaced"));
      expect(surface.reconnectingReasons.size).toBe(0);
    });

    it("publishes nothing when the owner changes during the follow-up request", async () => {
      const linux = await mountReachable();
      const descriptor = await fleet.spies.getRunner({ serverId: "linux" });
      let failFollowUp: (error: Error) => void = () => undefined;
      fleet.spies.getRunner
        .mockImplementationOnce(() => Promise.resolve(descriptor))
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              failFollowUp = reject;
            }),
        );
      failNextProjectListing(() => undefined);
      linux.emit("changed");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);

      await render({ workspaceOwner: "B" });
      await advance(10);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);

      await settle(() => failFollowUp(new Error("The runner is unreachable.")));

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      expect(surface.reconnectingReasons.size).toBe(0);
      expect(surface.snapshots.find((entry) => entry.serverId === "linux")?.error).toBeNull();
    });
  });

  describe("a refresh refused as busy", () => {
    const BUSY = "Too many server requests are still in progress; retry shortly";
    const snapshot = () => surface.snapshots.find((entry) => entry.serverId === "linux");

    async function mountLive(): Promise<FakeRunnerHost> {
      const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
      fleet = fakeRunnerFleetGateway([linux]);
      options = { workspaceOwner: "A", servers: [linux.server] };
      await render();
      await advance(10);
      linux.emit("connected");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      return linux;
    }

    function refuse(linux: FakeRunnerHost, failure: unknown): void {
      linux.failure = failure;
      linux.up = false;
    }

    it.each([BUSY, "Runner request failed (HTTP 503)."])(
      "keeps a reachable server reachable and connected after %j",
      async (busy) => {
        const linux = await mountLive();
        refuse(linux, busy);
        linux.emit("changed");
        await advance(300);

        expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
        expect(surface.reconnectingReasons.size).toBe(0);
        expect(snapshot()?.connected).toBe(true);
        expect(snapshot()?.error).toBeNull();
        expect(snapshot()?.tasks).toHaveLength(1);
      },
    );

    it("keeps the server connected when only a later request of the refresh is refused", async () => {
      const linux = await mountLive();
      fleet.spies.listProjects.mockImplementationOnce(() => Promise.reject(BUSY));
      linux.emit("changed");
      await advance(300);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      expect(snapshot()?.connected).toBe(true);
      expect(snapshot()?.error).toBeNull();
    });

    it.each([BUSY, "Runner request failed (HTTP 503)."])(
      "reports a replaced runner proven after %j without the busy text",
      async (busy) => {
        const linux = await mountLive();
        fleet.spies.listProjects.mockImplementationOnce(() => {
          linux.runnerId = "replacement";
          return Promise.reject(busy);
        });
        linux.emit("changed");
        await advance(300);

        expect(surface.reachability.get("linux")).toBe(remoteRunnerDisconnected("runnerReplaced"));
        expect(surface.reconnectingReasons.size).toBe(0);
        expect(snapshot()?.connected).toBe(false);
        expect(snapshot()?.error).toBe("Could not refresh remote tasks.");
      },
    );

    it.each([BUSY, "Runner request failed (HTTP 503)."])(
      "reports the outage its follow-up found after %j with the real failure",
      async (busy) => {
        const linux = await mountLive();
        fleet.spies.listProjects.mockImplementationOnce(() => {
          refuse(linux, new Error("SSH tunnel is down."));
          return Promise.reject(busy);
        });
        linux.emit("changed");
        await advance(300);

        expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
        expect(surface.reconnectingReasons.get("linux")).toBe("SSH tunnel is down.");
        expect(snapshot()?.connected).toBe(false);
        expect(snapshot()?.error).toBe("SSH tunnel is down.");
      },
    );

    it("keeps the real failure as the error when only its follow-up is refused", async () => {
      const linux = await mountLive();
      fleet.spies.listProjects.mockImplementationOnce(() => {
        refuse(linux, BUSY);
        return Promise.reject(new Error("The connection closed during the request."));
      });
      linux.emit("changed");
      await advance(300);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.get("linux")).toBe(
        "The connection closed during the request.",
      );
      expect(snapshot()?.error).toBe("The connection closed during the request.");
    });

    it("retries well before the live reconciliation interval and then recovers", async () => {
      const linux = await mountLive();
      refuse(linux, BUSY);
      linux.emit("changed");
      await advance(300);
      const refused = fleet.spies.getRunner.mock.calls.length;

      await advance(1_900);
      expect(fleet.spies.getRunner).toHaveBeenCalledTimes(refused);
      await advance(100);
      expect(fleet.spies.getRunner).toHaveBeenCalledTimes(refused + 1);

      linux.up = true;
      await advance(4_000);
      expect(fleet.spies.getRunner).toHaveBeenCalledTimes(refused + 2);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      await advance(59_000);
      expect(fleet.spies.getRunner).toHaveBeenCalledTimes(refused + 2);
    });

    it("knows nothing yet when the first refresh is refused and names no outage reason", async () => {
      const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
      refuse(linux, BUSY);
      fleet = fakeRunnerFleetGateway([linux]);
      options = { workspaceOwner: "A", servers: [linux.server] };
      await render();
      await advance(10);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.size).toBe(0);
      expect(snapshot()?.connected).toBe(false);
      expect(snapshot()?.error).not.toContain("busy");

      linux.up = true;
      await advance(2_100);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      expect(snapshot()?.connected).toBe(true);
      expect(snapshot()?.error).toBeNull();
    });

    it("does not confirm a changed endpoint it could not refresh", async () => {
      const linux = await mountLive();
      refuse(linux, BUSY);
      await render({ servers: [{ ...linux.server, port: 2222 }] });
      await advance(10);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.size).toBe(0);
      expect(snapshot()?.connected).toBe(false);
    });

    it("does not present the refused first refresh of a new owner as connected", async () => {
      const linux = await mountLive();
      refuse(linux, BUSY);
      await render({ workspaceOwner: "B" });
      await advance(10);

      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.size).toBe(0);
      expect(snapshot()?.connected).toBe(false);
      expect(snapshot()?.error).toBeNull();
    });

    it("reports a real failure after a refused refresh and clears it on success", async () => {
      const linux = await mountLive();
      refuse(linux, BUSY);
      linux.emit("changed");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);

      linux.failure = new Error("SSH tunnel is down.");
      linux.emit("changed");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.get("linux")).toBe("SSH tunnel is down.");
      expect(snapshot()?.connected).toBe(false);

      linux.failure = BUSY;
      linux.emit("changed");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
      expect(surface.reconnectingReasons.get("linux")).toBe("SSH tunnel is down.");
      expect(snapshot()?.connected).toBe(false);

      linux.up = true;
      linux.emit("changed");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
      expect(surface.reconnectingReasons.size).toBe(0);
      expect(snapshot()?.connected).toBe(true);
      expect(snapshot()?.error).toBeNull();
    });

    it("keeps the live cadence for a replaced runner that needs the user", async () => {
      const linux = await mountLive();
      linux.runnerId = "replacement";
      linux.emit("changed");
      await advance(300);
      expect(surface.reachability.get("linux")).toBe(remoteRunnerDisconnected("runnerReplaced"));
      const replaced = fleet.spies.getRunner.mock.calls.length;

      await advance(59_000);
      expect(fleet.spies.getRunner).toHaveBeenCalledTimes(replaced);
    });
  });

  it("starts a removed and re-added server without its old observation", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    linux.goDown();
    await advance(300);
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);

    await render({ servers: [] });
    await advance(10);
    expect(surface.reachability.size).toBe(0);
    expect(surface.snapshots).toEqual([]);

    linux.up = true;
    const readded = await deferNextDescriptor();
    await render({ servers: [linux.server] });
    await advance(10);

    expect(surface.reachability.size).toBe(0);
    expect(surface.reconnectingReasons.size).toBe(0);
    expect(surface.snapshots).toEqual([]);

    await settle(() => readded.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("drops a late successful refresh of the previous endpoint", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    linux.goDown();
    await advance(300);
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);

    linux.up = true;
    const previous = await deferNextDescriptor();
    await advance(2_100);
    const moved = await deferNextDescriptor();
    await render({ servers: [{ ...linux.server, port: 2222 }] });
    await advance(10);

    await settle(() => previous.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);

    await settle(() => moved.answer());
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("drops a late successful refresh of the previous workspace owner", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    const first = await deferNextDescriptor();
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);

    const next = await deferNextDescriptor();
    await render({ workspaceOwner: "B" });
    await advance(10);
    expect(surface.reachability.size).toBe(0);

    await settle(() => first.answer());
    expect(surface.reachability.size).toBe(0);
    expect(surface.snapshots).toEqual([]);

    linux.up = false;
    await settle(() => next.fail(new Error("The runner is unreachable.")));
    expect(surface.snapshots.find((entry) => entry.serverId === "linux")?.descriptor).toBeNull();
    expect(surface.reachability.get("linux")).toBe(REMOTE_RUNNER_RECONNECTING);
  });

  it("carries a bounded reason only while the server is reconnecting", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    fleet = fakeRunnerFleetGateway([linux]);
    options = { workspaceOwner: "A", servers: [linux.server] };
    await render();
    await advance(10);
    expect(surface.reconnectingReasons.size).toBe(0);

    linux.failure = `SSH tunnel\nauthentication failed. ${"x".repeat(2_000)}`;
    linux.goDown();
    await advance(300);
    const reason = surface.reconnectingReasons.get("linux");
    expect(reason?.startsWith("SSH tunnel authentication failed. x")).toBe(true);
    expect(reason).toHaveLength(MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH);
    const reasons = surface.reconnectingReasons;
    await render();
    expect(surface.reconnectingReasons).toBe(reasons);

    linux.comeBack();
    await advance(300);
    expect(surface.reconnectingReasons.size).toBe(0);
  });
});
