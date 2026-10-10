// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import {
  projectFixture,
  threadsSurfaceFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import {
  remoteRunnerDisconnected,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
} from "../domain/remoteRunnerReachability";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../test/remoteRunnerOutageTestSupport";
import type { AgentThreadView } from "./agentThreadPorts";
import { remoteAgentProjectKey } from "./remoteAgentProjection";
import { useUnifiedAgentThreads, type UnifiedAgentThreadsOptions } from "./useUnifiedAgentThreads";

const LAUNCH = {
  provider: "claudeCode",
  model: "default",
  mode: "default",
  effort: "default",
} as const;

describe("remote runner reachability on the unified agent surface", () => {
  let root: Root;
  let current: ReturnType<typeof useUnifiedAgentThreads>;
  let options: UnifiedAgentThreadsOptions;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Harness() {
    current = useUnifiedAgentThreads(options);
    return null;
  }

  async function render(patch: Partial<UnifiedAgentThreadsOptions> = {}): Promise<void> {
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

  async function mount(hosts: readonly FakeRunnerHost[], selected: FakeRunnerHost | null) {
    const fleet = fakeRunnerFleetGateway(hosts);
    options = {
      local: threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      gateway: fleet.gateway,
      servers: hosts.map((host) => host.server),
      selectedServerId: selected?.options.id ?? null,
      workspaceOwner: "A",
      selectedThreadId: selected?.threadId ?? null,
      localProjects: [projectFixture()],
      gitSync: null,
      repositoryIdentity: null,
      externalUrlOpener: null,
    };
    await render();
    await advance(10);
    for (const host of hosts) host.emit("connected");
    await advance(300);
    return fleet;
  }

  function view(threadId: string): AgentThreadView {
    const found = current.agents.threads.find((entry) => entry.thread.threadId === threadId);
    expect(found).toBeDefined();
    return found!;
  }

  async function outage(host: FakeRunnerHost): Promise<void> {
    host.goDown();
    await advance(300);
  }

  async function recovery(host: FakeRunnerHost): Promise<void> {
    host.comeBack();
    await advance(300);
  }

  it("names the outage, keeps the conversation and recovers by itself", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const fleet = await mount([linux], linux);
    const before = view(linux.threadId);
    expect(before.execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
    expect(before.lifecycle).toBe("running");
    const eventsBefore = before.thread.turns[0]?.events;
    expect(eventsBefore?.length).toBeGreaterThan(0);

    await outage(linux);

    const during = view(linux.threadId);
    expect(during.execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(during.lifecycle).toBe("running");
    expect(during.thread.turns[0]?.events).toBe(eventsBefore);
    expect(current.agents.notice).toBeNull();

    const callsBeforePolling = fleet.spies.getRunner.mock.calls.length;
    await advance(4_500);
    expect(fleet.spies.getRunner.mock.calls.length).toBeGreaterThan(callsBeforePolling + 1);
    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);

    linux.output("Written while the editor could not reach the runner");
    await recovery(linux);

    const after = view(linux.threadId);
    expect(after.execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
    expect(JSON.stringify(eventsBefore)).not.toContain("Written while the editor");
    expect(JSON.stringify(after.thread.turns[0]?.events)).toContain("Written while the editor");
    expect(current.agents.notice).toBeNull();
  });

  it("keeps the execution and its reachability referentially stable while nothing changes", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    await mount([linux], linux);
    const reachable = view(linux.threadId);
    await render();
    await render();
    expect(view(linux.threadId)).toBe(reachable);
    expect(view(linux.threadId).execution).toBe(reachable.execution);
    expect(reachable.execution?.reachabilityDetail).toBeUndefined();

    await outage(linux);
    const reconnecting = view(linux.threadId);
    expect(reconnecting).not.toBe(reachable);
    await render();
    await advance(4_500);
    await render();
    expect(view(linux.threadId)).toBe(reconnecting);
    expect(view(linux.threadId).execution).toBe(reconnecting.execution);
    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(view(linux.threadId).execution?.reachabilityDetail).toBe("The runner is unreachable.");

    linux.failure = "SSH tunnel authentication failed.";
    await advance(2_100);
    expect(view(linux.threadId)).not.toBe(reconnecting);
    expect(view(linux.threadId).execution?.reachabilityDetail).toBe(
      "SSH tunnel authentication failed.",
    );
  });

  it("treats a runner that stops answering after its descriptor as unreachable", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const fleet = await mount([linux], linux);
    fleet.spies.listProjects.mockImplementationOnce(() => {
      linux.up = false;
      return Promise.reject(new Error("The connection closed during the request."));
    });
    linux.emit("changed");
    await advance(300);

    const during = view(linux.threadId);
    expect(during.execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(during.execution?.reachabilityDetail).toBe("The runner is unreachable.");
    expect(current.agents.notice).toBeNull();

    await recovery(linux);
    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("shows the turn as interrupted when the runner returns without it", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    await mount([linux], linux);
    await outage(linux);
    expect(view(linux.threadId).lifecycle).toBe("running");

    linux.interruptTasks();
    await recovery(linux);

    const after = view(linux.threadId);
    expect(after.execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
    expect(after.thread.turns[0]?.status).toEqual({ kind: "interrupted" });
    expect(after.lifecycle).not.toBe("running");
  });

  it("reports an explicit disconnect as disconnected and stops asking the runner", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const fleet = await mount([linux], linux);
    linux.connected = false;
    await render({ servers: [linux.server] });
    await advance(300);

    expect(view(linux.threadId).execution?.reachability).toBe(
      remoteRunnerDisconnected("serverDisconnected"),
    );
    expect(current.agents.notice).toBeNull();
    const calls = fleet.spies.getRunner.mock.calls.length;
    await advance(6_000);
    expect(fleet.spies.getRunner.mock.calls.length).toBe(calls);

    linux.connected = true;
    await render({ servers: [linux.server] });
    await advance(300);
    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("maps a replaced runner to disconnected instead of reconnecting forever", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    await mount([linux], linux);
    const threadId = linux.threadId;
    linux.runnerId = "replacement";
    linux.emit("changed");
    await advance(300);

    expect(view(threadId).execution?.reachability).toBe(remoteRunnerDisconnected("runnerReplaced"));
    expect(current.agents.notice).toBeNull();
    await advance(6_000);
    expect(view(threadId).execution?.reachability).toBe(remoteRunnerDisconnected("runnerReplaced"));
  });

  it("names the replacement remedy when an action is blocked by a replaced runner", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const fleet = await mount([linux], linux);
    const threadId = linux.threadId;
    linux.runnerId = "replacement";
    linux.emit("changed");
    await advance(300);

    await act(async () => {
      await current.agents.sendFollowUp(
        { threadId, prompt: "Keep going", launch: LAUNCH },
        "caller",
      );
    });
    expect(current.agents.notice?.message).toBe(
      "Message not sent: Linux is disconnected because its runner was replaced. Remove the server and add it again in Settings. Your draft is kept.",
    );

    await act(async () => {
      await current.agents.stop(threadId, { kind: "ui", source: "composerStopButton" });
    });
    expect(current.agents.notice?.message).toBe(
      "Linux is disconnected because its runner was replaced. Remove the server and add it again in Settings.",
    );
    expect(fleet.spies.continueTask).not.toHaveBeenCalled();
    expect(fleet.spies.cancelTask).not.toHaveBeenCalled();
  });

  it("marks only the threads of the unreachable server", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const mac = new FakeRunnerHost({ id: "mac", name: "Mac" });
    await mount([linux, mac], linux);

    await outage(linux);

    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(view(mac.threadId).execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
    expect(view("agt-1").execution).toBeUndefined();

    await recovery(linux);
    await outage(mac);

    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
    expect(view(mac.threadId).execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);
  });

  it("blocks sending with a named reason that clears on recovery", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { pendingMessages: true, taskSteering: true },
    });
    const fleet = await mount([linux], linux);
    await outage(linux);

    let sent: boolean | undefined;
    await act(async () => {
      sent = await current.agents.sendFollowUp(
        { threadId: linux.threadId, prompt: "Keep going", launch: LAUNCH },
        "caller",
      );
    });
    expect(sent).toBe(false);
    expect(current.agents.notice?.message).toBe(
      "Message not sent: Linux is reconnecting. Your draft is kept.",
    );

    let steered: string | undefined;
    await act(async () => {
      steered = await current.agents.steer({
        threadId: linux.threadId,
        prompt: "Keep going",
        delivery: "immediate",
      });
    });
    expect(steered).toBe("kept");

    await act(async () => {
      await current.agents.stop(linux.threadId, { kind: "ui", source: "composerStopButton" });
    });
    expect(current.agents.notice?.message).toBe(
      "Linux is reconnecting. Try again once it is back.",
    );
    expect(fleet.spies.continueTask).not.toHaveBeenCalled();
    expect(fleet.spies.enqueueMessage).not.toHaveBeenCalled();
    expect(fleet.spies.steerTask).not.toHaveBeenCalled();
    expect(fleet.spies.cancelTask).not.toHaveBeenCalled();

    await recovery(linux);
    expect(current.agents.notice).toBeNull();
  });

  it("keeps staged images in the composer when a send is blocked by the outage", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:staged";
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { pendingMessages: true, taskSteering: true },
    });
    const fleet = await mount([linux], linux);
    const projectKey = remoteAgentProjectKey("linux", "runner", "project");
    await render({
      attachmentEncoder: { encode: async (bytes) => btoa(String.fromCharCode(...bytes)) },
      imageSurface: {
        decode: async () => ({ width: 1, height: 1 }),
        encodeMime: async () => "image/png",
        encode: async () => new ArrayBuffer(4),
        release: () => undefined,
      },
    });
    const staged = () => current.agents.attachments.forDraft!(linux.threadId);
    await act(async () => {
      await staged().add(projectKey, [
        { kind: "bytes", name: "shot.png", mime: "image/png", bytes: new ArrayBuffer(4) },
      ]);
    });
    const image = staged().drafts[0];
    expect(image?.state).toBe("ready");

    await outage(linux);
    expect(staged().drafts).toEqual([image]);

    const prepared = await staged().prepareTurn(projectKey);
    expect(prepared).not.toBeNull();
    const request = {
      threadId: linux.threadId,
      prompt: "Look at this",
      attachments: prepared!.intents,
      attachmentOwner: prepared!.owner,
    };

    let steered: string | undefined;
    let sent: boolean | undefined;
    await act(async () => {
      steered = await current.agents.steer({ ...request, delivery: "queued" });
      sent = await current.agents.sendFollowUp({ ...request, launch: LAUNCH }, "caller");
    });

    expect(steered).toBe("kept");
    expect(sent).toBe(false);
    expect(current.agents.notice?.message).toBe(
      "Message not sent: Linux is reconnecting. Your draft is kept.",
    );
    expect(staged().drafts).toEqual([image]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(fleet.spies.uploadAttachment).not.toHaveBeenCalled();
    expect(fleet.spies.enqueueMessage).not.toHaveBeenCalled();
  });

  it("keeps an unrelated runner error visible while the runner still answers", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    await mount([linux], linux);
    linux.invalidHistory = true;
    linux.emit("changed");
    await advance(300);

    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_REACHABLE);
    expect(current.agents.notice?.message).toBe("The runner returned invalid task history.");
  });

  it("keeps the server error on a draft, where no thread banner can replace it", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    await mount([linux], null);
    await render({ selectedServerId: "linux" });
    await advance(300);
    await outage(linux);

    expect(view(linux.threadId).execution?.reachability).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(current.agents.notice?.message).toBe("The runner is unreachable.");
  });
});
