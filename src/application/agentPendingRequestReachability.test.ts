import { describe, expect, it } from "vitest";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import {
  remoteRunnerDisconnected,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
  type RemoteRunnerReachability,
} from "../domain/remoteRunnerReachability";
import { agentPendingRequestAvailability } from "./agentPendingRequestReachability";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  remoteAgentUnreachableMessage,
  type RemoteAgentBlockedAction,
} from "./remoteAgentReachabilityNotice";

const remoteView = (reachability: RemoteRunnerReachability): AgentThreadView => ({
  ...surfaceThreadView(),
  execution: {
    kind: "remote",
    serverId: "server",
    runnerId: "runner",
    projectId: "project",
    conversationId: "conversation",
    latestTaskId: "task",
    resume: null,
    reachability,
  },
});

describe("pending request availability", () => {
  it("stays available without a thread and for a local thread", () => {
    expect(agentPendingRequestAvailability(null)).toBe("available");
    expect(agentPendingRequestAvailability(surfaceThreadView())).toBe("available");
  });

  it("follows the reachability of the thread's server", () => {
    expect(agentPendingRequestAvailability(remoteView(REMOTE_RUNNER_REACHABLE))).toBe("available");
    expect(agentPendingRequestAvailability(remoteView(REMOTE_RUNNER_RECONNECTING))).toBe(
      "unreachable",
    );
    expect(
      agentPendingRequestAvailability(remoteView(remoteRunnerDisconnected("serverDisconnected"))),
    ).toBe("unreachable");
    expect(
      agentPendingRequestAvailability(remoteView(remoteRunnerDisconnected("runnerReplaced"))),
    ).toBe("unreachable");
  });
});

describe("blocked remote action notice", () => {
  const message = (
    reachability: RemoteRunnerReachability,
    action: RemoteAgentBlockedAction,
    name: string | null = "Linux",
  ) => remoteAgentUnreachableMessage(reachability, name, action);

  it("has nothing to say while the server is reachable", () => {
    expect(message(REMOTE_RUNNER_REACHABLE, "send")).toBeNull();
    expect(message(REMOTE_RUNNER_REACHABLE, "command")).toBeNull();
  });

  it("names the server and the kept draft for a blocked send", () => {
    expect(message(REMOTE_RUNNER_RECONNECTING, "send")).toBe(
      "Message not sent: Linux is reconnecting. Your draft is kept.",
    );
    expect(message(remoteRunnerDisconnected("serverDisconnected"), "send")).toBe(
      "Message not sent: Linux is disconnected. Your draft is kept.",
    );
  });

  it("explains a blocked command without mentioning a draft", () => {
    expect(message(REMOTE_RUNNER_RECONNECTING, "command")).toBe(
      "Linux is reconnecting. Try again once it is back.",
    );
    expect(message(remoteRunnerDisconnected("serverDisconnected"), "command", null)).toBe(
      "The server is disconnected. Reconnect it to continue.",
    );
  });

  it("points at the replacement remedy for both actions when the runner was replaced", () => {
    const replaced = remoteRunnerDisconnected("runnerReplaced");
    expect(message(replaced, "command")).toBe(
      "Linux is disconnected because its runner was replaced. Remove the server and add it again in Settings.",
    );
    expect(message(replaced, "send")).toBe(
      "Message not sent: Linux is disconnected because its runner was replaced. Remove the server and add it again in Settings. Your draft is kept.",
    );
    expect(message(replaced, "command")).not.toContain("Reconnect it");
  });
});
