// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import { useUnifiedAgentThreads } from "../../application/useUnifiedAgentThreads";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../../test/remoteRunnerOutageTestSupport";
import {
  useRemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH } from "../../domain/remoteRunnerReachability";
import {
  AGENT_SERVER_RECONNECT_FAILED,
  AGENT_SERVER_RECONNECTING_GRACE_MS,
} from "./agentServerReachabilityPresentation";
import { threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { useAgentComposerDrawerExtras } from "./useAgentComposerDrawerExtras";

const NO_SERVERS: readonly RemoteRunnerServer[] = [];
const RECONNECTING = "Linux is reconnecting…";
const UNREACHABLE = "The runner is unreachable.";
const DISCONNECTED = "Linux is disconnected";

interface SceneProps {
  readonly local: AgentThreadsSurface;
  readonly selectedThreadId: string;
  readonly withRetry: boolean;
  readonly composerKey: number;
  readonly onRemote: (remote: RemoteRunnerContextValue | null) => void;
}

function Scene({ local, selectedThreadId, withRetry, composerKey, onRemote }: SceneProps) {
  const remote = useRemoteRunnerContext();
  onRemote(remote);
  const unified = useUnifiedAgentThreads({
    local,
    gateway: remote?.gateway ?? null,
    servers: remote?.servers ?? NO_SERVERS,
    selectedServerId: null,
    workspaceOwner: "A",
    selectedThreadId,
    localProjects: [],
    gitSync: null,
    repositoryIdentity: null,
    externalUrlOpener: null,
  });
  const thread =
    unified.agents.threads.find((view) => view.thread.threadId === selectedThreadId) ?? null;
  const refresh = unified.refreshRemote;
  const input = useMemo(
    () => ({
      thread,
      branchMemory: null,
      liveCheckoutBranches: null,
      ...(withRetry ? { retryServer: refresh } : {}),
    }),
    [thread, withRetry, refresh],
  );
  const extras = useAgentComposerDrawerExtras(undefined, undefined, input);
  return (
    <div data-composer={composerKey} key={composerKey}>
      {extras.banners}
    </div>
  );
}

describe("server reachability banner of the composer", () => {
  let host: HTMLDivElement;
  let root: Root;
  let linux: FakeRunnerHost;
  let mac: FakeRunnerHost;
  let fleet: ReturnType<typeof fakeRunnerFleetGateway>;
  let local: AgentThreadsSurface;
  let remote: RemoteRunnerContextValue | null;
  let consoleError: MockInstance<typeof console.error>;
  let scene: { withRetry: boolean; composerKey: number; selected: FakeRunnerHost };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    mac = new FakeRunnerHost({ id: "mac", name: "Mac" });
    fleet = fakeRunnerFleetGateway([linux, mac]);
    local = threadsSurfaceFixture();
    remote = null;
    scene = { withRetry: true, composerKey: 0, selected: linux };
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(
      consoleError.mock.calls.filter((args) =>
        /Maximum update depth|Too many re-renders|not wrapped in act/.test(args.join(" ")),
      ),
    ).toEqual([]);
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render(patch: Partial<typeof scene> = {}): Promise<void> {
    scene = { ...scene, ...patch };
    await act(async () => {
      root.render(
        <RemoteRunnerProvider gateway={fleet.gateway}>
          <Scene
            composerKey={scene.composerKey}
            local={local}
            onRemote={(value) => {
              remote = value;
            }}
            selectedThreadId={scene.selected.threadId}
            withRetry={scene.withRetry}
          />
        </RemoteRunnerProvider>,
      );
    });
  }

  async function advance(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  async function mount(patch: Partial<typeof scene> = {}): Promise<void> {
    await render(patch);
    await advance(10);
    linux.emit("connected");
    mac.emit("connected");
    await advance(300);
    expect(banner()).toBeNull();
  }

  async function outage(): Promise<void> {
    linux.goDown();
    await advance(300);
  }

  function banner(): string | null {
    return bannerElement()?.textContent ?? null;
  }

  function bannerElement(): Element | null {
    return (
      [...host.querySelectorAll(".cv-composer-banner")].find((element) =>
        /Linux|Mac/.test(element.textContent ?? ""),
      ) ?? null
    );
  }

  async function disconnect(serverId: string): Promise<void> {
    await act(async () => {
      await remote?.disconnect(serverId);
    });
    await advance(10);
  }

  function action(label: string): HTMLButtonElement | null {
    return (
      [...host.querySelectorAll<HTMLButtonElement>(".cv-composer-banner button")].find(
        (button) => button.textContent === label,
      ) ?? null
    );
  }

  async function click(label: string): Promise<void> {
    const button = action(label);
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
  }

  it("appears after the grace period and clears by itself when the server returns", async () => {
    await mount();
    await outage();
    expect(banner()).toBeNull();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS - 400);
    expect(banner()).toBeNull();

    await advance(400);
    expect(banner()).toBe(`${RECONNECTING} ${UNREACHABLE}Retry now`);
    expect(host.querySelector(".cv-composer-banner--working .cv-spinner")).not.toBeNull();

    linux.comeBack();
    await advance(300);
    expect(banner()).toBeNull();
  });

  it("stays silent for a blip and gives the next outage its full grace period", async () => {
    await mount();
    await outage();
    await advance(1_200);
    linux.comeBack();
    await advance(300);
    expect(banner()).toBeNull();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);
    expect(banner()).toBeNull();

    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS - 400);
    expect(banner()).toBeNull();
    await advance(400);
    expect(banner()).toContain(RECONNECTING);
  });

  it("retries once at a time and keeps the banner while the runner is still down", async () => {
    await mount();
    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);
    let fail: (error: Error) => void = () => undefined;
    fleet.spies.getRunner.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const calls = fleet.spies.getRunner.mock.calls.length;

    await click("Retry now");
    expect(fleet.spies.getRunner.mock.calls.length).toBe(calls + 1);
    expect(action("Retry now")?.disabled).toBe(true);
    await act(async () => {
      action("Retry now")?.click();
      action("Retry now")?.click();
    });
    expect(fleet.spies.getRunner.mock.calls.length).toBe(calls + 1);

    await act(async () => {
      fail(new Error("The runner is unreachable."));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(action("Retry now")?.disabled).toBe(false);
    expect(banner()).toContain(RECONNECTING);
  });

  it("clears as soon as a manual retry reaches the returned runner", async () => {
    await mount();
    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);
    expect(banner()).toContain(RECONNECTING);

    linux.up = true;
    await click("Retry now");
    await advance(10);

    expect(banner()).toBeNull();
  });

  it("stays truthful without an action when no retry is wired", async () => {
    await mount({ withRetry: false });
    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);

    expect(banner()).toBe(`${RECONNECTING} ${UNREACHABLE}`);
    expect(host.querySelector(".cv-composer-banner button")).toBeNull();

    linux.comeBack();
    await advance(300);
    expect(banner()).toBeNull();
  });

  it("shows a disconnected server at once and reconnects it through the connect flow", async () => {
    await mount();
    await disconnect("linux");
    expect(banner()).toBe(`${DISCONNECTED}Reconnect`);
    expect(host.querySelector(".cv-composer-banner--warn")).not.toBeNull();

    await click("Reconnect");
    await advance(300);

    expect(fleet.spies.connectServer).toHaveBeenCalledTimes(1);
    expect(fleet.spies.connectServer).toHaveBeenCalledWith({
      id: "linux",
      name: "Linux",
      host: "linux",
      username: "codex",
      port: 22,
    });
    expect(banner()).toBeNull();
  });

  it("explains a failed reconnect and lets the user try again", async () => {
    await mount();
    await disconnect("linux");
    linux.up = false;

    await click("Reconnect");
    await advance(10);

    expect(banner()).toBe(`${DISCONNECTED} ${AGENT_SERVER_RECONNECT_FAILED}Reconnect`);
    expect(action("Reconnect")?.disabled).toBe(false);

    linux.up = true;
    await click("Reconnect");
    await advance(300);
    expect(banner()).toBeNull();
  });

  it("forgets a failed reconnect once the server has recovered and a new outage begins", async () => {
    await mount();
    await disconnect("linux");
    linux.up = false;
    await click("Reconnect");
    await advance(10);
    expect(banner()).toContain(AGENT_SERVER_RECONNECT_FAILED);

    linux.up = true;
    await act(async () => {
      await remote?.connect({
        id: "linux",
        name: "Linux",
        host: "linux",
        username: "codex",
        port: 22,
      });
    });
    await advance(300);
    expect(banner()).toBeNull();

    await disconnect("linux");
    expect(banner()).toBe(`${DISCONNECTED}Reconnect`);
  });

  it("does not carry a failed reconnect to another thread or back again", async () => {
    await mount();
    await disconnect("linux");
    await disconnect("mac");
    linux.up = false;
    await click("Reconnect");
    await advance(10);
    expect(banner()).toContain(AGENT_SERVER_RECONNECT_FAILED);

    await render({ selected: mac });
    expect(banner()).toBe("Mac is disconnectedReconnect");

    await render({ selected: linux });
    expect(banner()).toBe(`${DISCONNECTED}Reconnect`);
  });

  it("ignores a reconnect that settles after the selection changed", async () => {
    await mount();
    await disconnect("linux");
    await disconnect("mac");
    let failConnect: (error: Error) => void = () => undefined;
    fleet.spies.connectServer.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failConnect = reject;
        }),
    );
    await click("Reconnect");
    expect(fleet.spies.connectServer).toHaveBeenCalledTimes(1);

    await render({ selected: mac });
    const refreshes = fleet.spies.getRunner.mock.calls.length;
    await act(async () => {
      failConnect(new Error("The runner is unreachable."));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(banner()).toBe("Mac is disconnectedReconnect");
    expect(fleet.spies.getRunner.mock.calls.length).toBe(refreshes);

    await render({ selected: linux });
    expect(banner()).toBe(`${DISCONNECTED}Reconnect`);
  });

  it("gives another thread its own action while a reconnect is still in flight", async () => {
    await mount();
    await disconnect("linux");
    mac.goDown();
    await advance(300);
    let failConnect: (error: Error) => void = () => undefined;
    fleet.spies.connectServer.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failConnect = reject;
        }),
    );
    await click("Reconnect");
    expect(action("Reconnect")?.disabled).toBe(true);

    await render({ selected: mac });
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);
    expect(banner()).toBe(`Mac is reconnecting… ${UNREACHABLE}Retry now`);
    expect(action("Retry now")?.disabled).toBe(false);

    let failRetry: (error: Error) => void = () => undefined;
    fleet.spies.getRunner.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failRetry = reject;
        }),
    );
    const macRequests = (): number =>
      fleet.spies.getRunner.mock.calls.filter(([request]) => request.serverId === "mac").length;
    const before = macRequests();
    await act(async () => {
      action("Retry now")?.click();
      action("Retry now")?.click();
    });
    expect(macRequests()).toBe(before + 1);
    expect(action("Retry now")?.disabled).toBe(true);

    await act(async () => {
      failConnect(new Error("The runner is unreachable."));
      await Promise.resolve();
    });
    expect(action("Retry now")?.disabled).toBe(true);
    expect(banner()).not.toContain(AGENT_SERVER_RECONNECT_FAILED);

    await act(async () => {
      failRetry(new Error("The runner is unreachable."));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(action("Retry now")?.disabled).toBe(false);

    await render({ selected: linux });
    expect(banner()).toBe(`${DISCONNECTED}Reconnect`);
    expect(action("Reconnect")?.disabled).toBe(false);
  });

  it("publishes nothing when its owner unmounts during a flight", async () => {
    await mount();
    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);
    let failRetry: (error: Error) => void = () => undefined;
    fleet.spies.getRunner.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failRetry = reject;
        }),
    );
    await click("Retry now");
    expect(action("Retry now")?.disabled).toBe(true);

    await act(async () => root.unmount());
    await act(async () => {
      failRetry(new Error("The runner is unreachable."));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(host.querySelector(".cv-composer-banner")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    root = createRoot(host);
  });

  it("shows why it is still reconnecting on one line with the full text in the title", async () => {
    await mount();
    linux.failure = `SSH tunnel authentication failed. ${"detail ".repeat(200)}`;
    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);

    const text = bannerElement()?.querySelector<HTMLElement>("[title]");
    expect(text?.textContent?.startsWith(`${RECONNECTING} SSH tunnel authentication failed.`)).toBe(
      true,
    );
    expect(text?.textContent?.endsWith("…")).toBe(true);
    expect(text?.textContent?.length).toBeLessThanOrEqual(
      RECONNECTING.length + 1 + MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH,
    );
    expect(text?.getAttribute("title")).toBe(text?.textContent);
    expect(text?.style.whiteSpace).toBe("nowrap");
    expect(text?.style.textOverflow).toBe("ellipsis");

    linux.failure = "Host is down.";
    await advance(2_100);
    expect(banner()).toBe(`${RECONNECTING} Host is down.Retry now`);
  });

  it("tells the truth about a replaced runner instead of retrying forever", async () => {
    await mount();
    linux.runnerId = "replacement";
    linux.emit("changed");
    await advance(300);

    expect(banner()).toBe(
      "Linux is disconnected: its runner was replaced. Remove the server and add it again in Settings.",
    );
    expect(host.querySelector(".cv-composer-banner button")).toBeNull();
    await advance(6_000);
    expect(banner()).toContain("its runner was replaced");
  });

  it("survives a composer remount", async () => {
    await mount();
    await outage();
    await advance(AGENT_SERVER_RECONNECTING_GRACE_MS);
    expect(banner()).toContain(RECONNECTING);

    await render({ composerKey: 1 });

    expect(host.querySelector('[data-composer="1"]')).not.toBeNull();
    expect(banner()).toContain(RECONNECTING);
    linux.comeBack();
    await advance(300);
    expect(banner()).toBeNull();
  });

  it("releases a pending grace timer when its owner unmounts", async () => {
    await mount();
    await outage();
    expect(banner()).toBeNull();

    await act(async () => root.unmount());

    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});
