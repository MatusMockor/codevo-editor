// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import {
  projectFixture,
  threadsSurfaceFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../test/remoteRunnerOutageTestSupport";
import type { AgentThreadView } from "./agentThreadPorts";
import { useUnifiedAgentThreads, type UnifiedAgentThreadsOptions } from "./useUnifiedAgentThreads";

describe("remote thread request facts on the unified agent surface", () => {
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

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(Harness));
    });
  }

  async function advance(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  async function mount(hosts: readonly FakeRunnerHost[], selected: FakeRunnerHost): Promise<void> {
    options = {
      local: threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
      gateway: fakeRunnerFleetGateway(hosts).gateway,
      servers: hosts.map((host) => host.server),
      selectedServerId: selected.options.id,
      workspaceOwner: "A",
      selectedThreadId: selected.threadId,
      localProjects: [projectFixture()],
      gitSync: null,
      repositoryIdentity: null,
      externalUrlOpener: null,
    };
    await render();
    await advance(10);
    for (const host of hosts) host.emit("connected");
    await advance(300);
  }

  function view(threadId: string): AgentThreadView {
    const found = current.agents.threads.find((entry) => entry.thread.threadId === threadId);
    expect(found, `view of ${threadId}`).toBeDefined();
    return found ?? surfaceThreadView();
  }

  it("reports a runner without the capability as a legacy source", async () => {
    const old = new FakeRunnerHost({ id: "old", name: "Old" });
    await mount([old], old);

    expect(view(old.threadId).execution?.requests).toEqual({
      source: "legacy",
      approvals: false,
      sequences: {},
      awaitingApproval: [],
    });
  });

  it("reports the advertised capabilities and the sequence of a running turn", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { runtimeRequests: true, interactiveApprovals: true },
    });
    linux.tasks = linux.tasks.map((task) => ({ ...task, interactionSequence: 3 }));
    await mount([linux], linux);

    expect(view(linux.threadId).execution?.requests).toEqual({
      source: "snapshot",
      approvals: true,
      sequences: { first: 3 },
      awaitingApproval: [],
    });
  });

  it("keeps the facts of two servers apart", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { runtimeRequests: true },
    });
    const old = new FakeRunnerHost({ id: "old", name: "Old" });
    linux.tasks = linux.tasks.map((task) => ({ ...task, interactionSequence: 5 }));
    await mount([linux, old], linux);

    expect(view(linux.threadId).execution?.requests?.source).toBe("snapshot");
    expect(view(linux.threadId).execution?.requests?.sequences).toEqual({ first: 5 });
    expect(view(old.threadId).execution?.requests?.source).toBe("legacy");
    expect(view(old.threadId).execution?.requests?.sequences).toEqual({});
  });

  it("keeps the view and its facts referentially stable across an unchanged refresh", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { runtimeRequests: true },
    });
    linux.tasks = linux.tasks.map((task) => ({ ...task, interactionSequence: 3 }));
    await mount([linux], linux);
    const before = view(linux.threadId);

    await render();
    linux.tasks = linux.tasks.map((task) => ({ ...task }));
    linux.emit("changed");
    await advance(2_000);

    expect(view(linux.threadId)).toBe(before);
    expect(view(linux.threadId).execution?.requests).toBe(before.execution?.requests);
  });

  it("re-identifies the view when the sequence of a running turn moves", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { runtimeRequests: true, interactiveApprovals: true },
    });
    linux.tasks = linux.tasks.map((task) => ({ ...task, interactionSequence: 3 }));
    await mount([linux], linux);
    const before = view(linux.threadId);

    linux.tasks = linux.tasks.map((task) => ({
      ...task,
      interactionSequence: 4,
      awaiting: "approval" as const,
    }));
    linux.emit("changed");
    await advance(2_000);

    const awaiting = view(linux.threadId);
    expect(awaiting).not.toBe(before);
    expect(awaiting.lifecycle).toBe("running");
    expect(awaiting.execution?.requests?.sequences).toEqual({ first: 4 });
    expect(awaiting.execution?.requests?.awaitingApproval).toEqual(["first"]);
    expect(before.execution?.requests?.sequences).toEqual({ first: 3 });

    linux.tasks = linux.tasks.map(({ awaiting: _awaiting, ...task }) => ({
      ...task,
      interactionSequence: 5,
    }));
    linux.emit("changed");
    await advance(2_000);

    const settled = view(linux.threadId);
    expect(settled).not.toBe(awaiting);
    expect(settled.execution?.requests?.sequences).toEqual({ first: 5 });
    expect(settled.execution?.requests?.awaitingApproval).toEqual([]);
  });

  it("re-identifies the view with the sequence a turn reports when it ends", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { runtimeRequests: true },
    });
    linux.tasks = linux.tasks.map((task) => ({ ...task, interactionSequence: 3 }));
    await mount([linux], linux);
    const before = view(linux.threadId);

    linux.interruptTasks();
    linux.tasks = linux.tasks.map((task) => ({ ...task, interactionSequence: 4 }));
    linux.emit("changed");
    await advance(2_000);

    const after = view(linux.threadId);
    expect(after).not.toBe(before);
    expect(after.lifecycle).not.toBe("running");
    expect(after.execution?.requests?.sequences).toEqual({ first: 4 });
    expect(before.execution?.requests?.sequences).toEqual({ first: 3 });
  });
});
