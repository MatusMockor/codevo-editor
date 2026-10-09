// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AGENT_PENDING_REQUEST_POLL_MS } from "../../application/agentPendingRequestPolling";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { projectRemoteAgentThreads } from "../../application/remoteAgentProjection";
import {
  remoteRunnerDisconnected,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
  type RemoteRunnerReachability,
} from "../../domain/remoteRunnerReachability";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { FakeRunnerHost } from "../../test/remoteRunnerOutageTestSupport";
import {
  AgentComposerController,
  type AgentComposerControllerProps,
} from "./AgentComposerController";

const noop = (): void => undefined;
const submit: AgentComposerControllerProps["submit"] = async () => true;
const PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;
const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const BANNERS = <span data-banners="" />;
const COMPOSER_PROPS: AgentComposerControllerProps["composerProps"] = {
  draftKey: "remote-thread",
  promptOwnerKey: "remote-thread",
  target: {
    projectLabel: "app",
    projectRoot: "/workspace/app",
    selectedRepositoryRoot: "/workspace/app",
    repositoryOptions: [],
  },
  isolation: "in-place",
  isolationReason: null,
  worktreeAvailable: false,
  worktreeOnly: false,
  worktreeOnlyReason: null,
  guard: { kind: "safe" },
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
  launchProvider: "claudeCode",
  dispatching: false,
  running: true,
  mode: { kind: "steer", threadId: "remote-thread" },
  onStop: noop,
  onSelectRepository: noop,
  onIsolationChange: noop,
  onLaunchChange: noop,
  onNewThread: noop,
};

describe("composer interactions while the thread's server is not reachable", () => {
  let host: HTMLDivElement;
  let root: Root;
  let linux: FakeRunnerHost;
  let list: ReturnType<typeof vi.fn<AgentQuestionGateway["list"]>>;
  let gateway: AgentQuestionGateway;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    list = vi.fn<AgentQuestionGateway["list"]>().mockResolvedValue([]);
    gateway = { list, answer: vi.fn() };
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(
      consoleError.mock.calls.filter((args) =>
        /Maximum update depth|Too many re-renders|not wrapped in act/.test(args.join(" ")),
      ),
    ).toEqual([]);
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function threadView(reachability: RemoteRunnerReachability): AgentThreadView {
    const [view] = projectRemoteAgentThreads({
      serverId: "linux",
      runnerId: linux.runnerId,
      projects: [{ id: "project", name: "App" }],
      tasks: linux.tasks,
      replays: new Map([["first", linux.eventsAfter(0)]]),
      resumes: new Map(),
      interactiveQuestionsSupported: true,
      reachability,
    });
    expect(view).toBeDefined();
    return view!;
  }

  async function render(reachability: RemoteRunnerReachability): Promise<void> {
    await act(async () => {
      root.render(
        <AgentComposerController
          banners={BANNERS}
          composerProps={COMPOSER_PROPS}
          executionServerId="linux"
          interactions={{ gateway, thread: threadView(reachability) }}
          onOpenProviderSettings={noop}
          providerEnabled={PROVIDERS_ENABLED}
          providerManagement={PROVIDER_MANAGEMENT}
          submissionBlocked={false}
          submit={submit}
        />,
      );
    });
  }

  async function advance(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  it("suspends question polling for a reachability-only change and resumes at once", async () => {
    await render(REMOTE_RUNNER_REACHABLE);
    await advance(3 * AGENT_PENDING_REQUEST_POLL_MS);
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(3);

    await render(REMOTE_RUNNER_RECONNECTING);
    const suspendedAt = list.mock.calls.length;
    await advance(5 * AGENT_PENDING_REQUEST_POLL_MS);
    expect(list.mock.calls.length).toBe(suspendedAt);
    expect(host.textContent).not.toContain("Questions could not be refreshed");

    await render(remoteRunnerDisconnected("serverDisconnected"));
    await advance(5 * AGENT_PENDING_REQUEST_POLL_MS);
    expect(list.mock.calls.length).toBe(suspendedAt);

    await render(REMOTE_RUNNER_REACHABLE);
    await advance(10);
    expect(list.mock.calls.length).toBe(suspendedAt + 1);
    await advance(2 * AGENT_PENDING_REQUEST_POLL_MS);
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(suspendedAt + 3);
  });

  it("keeps the composer mounted and editable in every reachability state", async () => {
    const states = [
      REMOTE_RUNNER_REACHABLE,
      REMOTE_RUNNER_RECONNECTING,
      remoteRunnerDisconnected("serverDisconnected"),
      remoteRunnerDisconnected("runnerReplaced"),
      REMOTE_RUNNER_REACHABLE,
    ];
    for (const reachability of states) {
      await render(reachability);
      await render(reachability);
      await advance(AGENT_PENDING_REQUEST_POLL_MS);
      expect(host.querySelector("textarea")).not.toBeNull();
      expect(host.querySelector("[data-banners]")).not.toBeNull();
    }
  });
});
