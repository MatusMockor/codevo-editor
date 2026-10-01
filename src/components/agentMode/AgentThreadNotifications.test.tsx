// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentAppFocusPort,
  AgentSystemAttentionPort,
} from "../../application/agentThreadNotificationCenter";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentThreadNotificationCenter } from "../../application/useAgentThreadNotificationCenter";
import type { AgentTurnStatus } from "../../domain/agentThread";
import { AgentThreadNotifications } from "./AgentThreadNotifications";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

const FOCUSED: AgentAppFocusPort = { isFocused: () => true, subscribe: () => () => undefined };
const SYSTEM: AgentSystemAttentionPort = {
  notify: async () => "delivered",
  setBadgeCount: async () => undefined,
  recheckPermission: () => undefined,
};
const PORTS = () => ({ focus: FOCUSED, system: SYSTEM });

function view(threadId: string, status: AgentTurnStatus): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    lifecycle: status.kind === "running" ? "running" : "settled",
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      turns: [
        {
          turnId: `${threadId}-turn`,
          prompt: "go",
          status,
          startedAtEpochMs: 1,
          endedAtEpochMs: status.kind === "running" ? null : 2,
          events: [],
          eventsTruncated: false,
          lastStatusSequence: 1,
          lastOutputSequence: 0,
          launch: null,
          cliVersion: null,
        },
      ],
    },
  });
}

function Harness({
  settingsOpen,
  views,
  visibleThreadId,
}: {
  readonly settingsOpen: boolean;
  readonly views: ReadonlyArray<AgentThreadView>;
  readonly visibleThreadId: string | null;
}) {
  const center = useAgentThreadNotificationCenter(
    { enabled: true, toastsVisible: !settingsOpen, threadViewVisible: !settingsOpen },
    PORTS,
  );
  return (
    <AgentThreadNotifications
      center={center}
      interactions={new Map()}
      onSelectThread={() => undefined}
      projects={[]}
      views={views}
      visibleThreadId={visibleThreadId}
    />
  );
}

describe("AgentThreadNotifications", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("uses the thread shown after Settings closes when it releases held events", () => {
    const running = [view("a1", { kind: "running" }), view("b1", { kind: "running" })];
    const finished = [view("a1", { kind: "running" }), view("b1", { kind: "exited", exitCode: 0 })];
    act(() => root.render(<Harness settingsOpen={false} views={running} visibleThreadId="a1" />));
    act(() => root.render(<Harness settingsOpen views={finished} visibleThreadId="a1" />));
    expect(document.querySelectorAll(".cv-toast")).toHaveLength(0);

    act(() => root.render(<Harness settingsOpen={false} views={finished} visibleThreadId="b1" />));

    expect(document.querySelectorAll(".cv-toast")).toHaveLength(0);
  });
});
