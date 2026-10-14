// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn } from "../domain/agentThread";
import type { RemoteRunnerReachability } from "../domain/remoteRunnerReachability";
import { remoteAgentThreadRequestScope } from "../domain/remoteAgentThreadRequestScope";
import { agentThreadRequestFeedFake } from "../test/agentThreadRequestFeedFake";
import type { AgentThreadRequestFeed } from "./agentThreadRequestPorts";
import type { RemoteAgentThreadExecution } from "./agentThreadPorts";
import { MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS } from "./remoteAgentThreadRequestWatch";
import {
  createUnifiedAgentThreadRequestFeed,
  type RemoteAgentThreadRequestControl,
} from "./unifiedAgentThreadRequestFeed";
import {
  useRemoteAgentThreadRequestSync,
  type RemoteAgentThreadRequestTarget,
} from "./useRemoteAgentThreadRequestSync";

const CONVERSATION = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";

function turn(turnId: string, running: boolean): AgentTurn {
  return {
    turnId,
    prompt: "Work",
    status: running ? { kind: "running" } : { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_760_000_000_000,
    endedAtEpochMs: running ? null : 1_760_000_100_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function execution(
  serverId: string,
  reachability: RemoteRunnerReachability = { kind: "reachable" },
  requests: RemoteAgentThreadExecution["requests"] = undefined,
): RemoteAgentThreadExecution {
  return {
    kind: "remote",
    serverId,
    runnerId: "runner-1",
    projectId: "project-1",
    conversationId: CONVERSATION,
    latestTaskId: "turn-2",
    resume: null,
    reachability,
    ...(requests === undefined ? {} : { requests }),
  };
}

function target(
  remote: RemoteAgentThreadExecution,
  turns: readonly AgentTurn[] = [turn("turn-1", false), turn("turn-2", true)],
): RemoteAgentThreadRequestTarget {
  const { serverId, runnerId, projectId, conversationId } = remote;
  const scope = remoteAgentThreadRequestScope({ serverId, runnerId, projectId, conversationId });
  expect(scope).not.toBeNull();
  return {
    scope: scope ?? { rootKey: "", ownerId: "", threadId: "", workspaceId: null },
    execution: remote,
    turns,
  };
}

describe("useRemoteAgentThreadRequestSync", () => {
  let host: HTMLDivElement;
  let root: Root;
  let control: RemoteAgentThreadRequestControl & {
    readonly describe: ReturnType<typeof vi.fn<RemoteAgentThreadRequestControl["describe"]>>;
    readonly release: ReturnType<typeof vi.fn<RemoteAgentThreadRequestControl["release"]>>;
    readonly reconnected: ReturnType<typeof vi.fn<RemoteAgentThreadRequestControl["reconnected"]>>;
  };
  let order: string[];
  let feed: AgentThreadRequestFeed;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    order = [];
    control = {
      describe: vi.fn<RemoteAgentThreadRequestControl["describe"]>((scope) => {
        order.push(`describe ${scope.workspaceId}`);
        return { kind: "tracked" };
      }),
      release: vi.fn<RemoteAgentThreadRequestControl["release"]>((scope) => {
        order.push(`release ${scope.workspaceId}`);
      }),
      reconnected: vi.fn<RemoteAgentThreadRequestControl["reconnected"]>((serverId) => {
        order.push(`reconnected ${serverId}`);
      }),
      respond: vi.fn(),
      confirm: vi.fn(),
    };
    feed = createUnifiedAgentThreadRequestFeed({
      local: agentThreadRequestFeedFake(),
      remote: { ...agentThreadRequestFeedFake(), ...control },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe({ value }: { readonly value: RemoteAgentThreadRequestTarget | null }) {
    useRemoteAgentThreadRequestSync(feed, value);
    return null;
  }

  function render(value: RemoteAgentThreadRequestTarget | null): void {
    act(() => root.render(<Probe value={value} />));
  }

  it("describes every watched turn in thread order with its sequence, terminal state and reachability", () => {
    const facts = {
      source: "snapshot",
      approvals: true,
      sequences: { "turn-2": 7 },
      awaitingApproval: ["turn-2"],
    } as const;

    render(target(execution("srv-a", { kind: "reachable" }, facts)));

    expect(control.describe).toHaveBeenCalledTimes(1);
    expect(control.describe.mock.calls[0]?.[1]).toEqual({
      source: "snapshot",
      reachable: true,
      turns: [
        {
          turnId: "turn-1",
          startedAtEpochMs: 1_760_000_000_000,
          interactionSequence: null,
          terminal: true,
        },
        {
          turnId: "turn-2",
          startedAtEpochMs: 1_760_000_000_000,
          interactionSequence: 7,
          terminal: false,
        },
      ],
      awaiting: ["turn-2"],
    });
  });

  it("describes a runner without request facts as legacy and caps the described turns", () => {
    const many = Array.from(
      { length: MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS + 3 },
      (_unused, index) => turn(`turn-${index}`, false),
    );

    render(
      target(execution("srv-a", { kind: "disconnected", reason: "serverDisconnected" }), many),
    );

    const description = control.describe.mock.calls[0]?.[1];
    expect(description?.source).toBe("legacy");
    expect(description?.reachable).toBe(false);
    expect(description?.awaiting).toEqual([]);
    expect(description?.turns).toHaveLength(MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS);
    expect(description?.turns[0]?.turnId).toBe("turn-3");
  });

  it("releases on unmount and across server A -> B -> A, always before the next describe", () => {
    render(target(execution("srv-a")));
    render(target(execution("srv-b")));
    render(target(execution("srv-a")));
    render(null);

    expect(order).toEqual([
      "describe srv-a",
      "release srv-a",
      "describe srv-b",
      "release srv-b",
      "describe srv-a",
      "release srv-a",
    ]);
  });

  it("re-describes on view changes without releasing and reports a server that is reachable again", () => {
    render(target(execution("srv-a")));
    render(target(execution("srv-a", { kind: "reconnecting" })));
    render(target(execution("srv-a")));
    render(target(execution("srv-b")));

    expect(order).toEqual([
      "describe srv-a",
      "describe srv-a",
      "describe srv-a",
      "reconnected srv-a",
      "release srv-a",
      "describe srv-b",
    ]);
    expect(control.describe.mock.calls.map(([, description]) => description.reachable)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("does nothing for a local thread or a feed without a remote side", () => {
    render(null);
    act(() => root.render(<PlainProbe value={target(execution("srv-a"))} />));

    expect(order).toEqual([]);
  });
});

const PLAIN_FEED = agentThreadRequestFeedFake();

function PlainProbe({ value }: { readonly value: RemoteAgentThreadRequestTarget }) {
  useRemoteAgentThreadRequestSync(PLAIN_FEED, value);
  return null;
}
