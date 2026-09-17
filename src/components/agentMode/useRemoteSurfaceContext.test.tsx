// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceCapabilities,
} from "../../domain/remoteRunnerSurfaces";
import type { RemoteRunnerContextValue } from "../remoteRunner/remoteRunnerContext";
import { remoteSurfaceScope, useRemoteSurfaceContext } from "./useRemoteSurfaceContext";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

const connected = {
  id: "server",
  host: "host",
  name: "Linux",
  username: "user",
  port: 22,
  connected: true,
};
const yes = { files: true, history: true, terminal: true };
const remoteThread = {
  ...surfaceThreadView(),
  execution: {
    kind: "remote" as const,
    serverId: "server",
    runnerId: "runner",
    projectId: "project",
    conversationId: "conversation",
    latestTaskId: "latest",
    resume: null,
  },
};

// This hook intentionally needs no task gateway or connection mutation authority.
function context(
  gateway: RemoteRunnerSurfacesGateway,
  server = connected,
): Pick<RemoteRunnerContextValue, "servers" | "surfacesGateway"> {
  return { surfacesGateway: gateway, servers: [server] };
}
function gateway(): RemoteRunnerSurfacesGateway {
  return {
    capabilities: vi.fn(),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    history: vi.fn(),
    commitFiles: vi.fn(),
    commitDiff: vi.fn(),
    openTerminal: vi.fn(),
    pollTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  };
}

describe("remote surface composition", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useRemoteSurfaceContext>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => act(() => root.unmount()));
  function Harness(props: Parameters<typeof useRemoteSurfaceContext>[0]) {
    current = useRemoteSurfaceContext(props);
    return null;
  }
  function render(
    remote: Pick<RemoteRunnerContextValue, "servers" | "surfacesGateway">,
    draftProjectRootKey = "remote:server:runner:project",
    thread: typeof remoteThread | null = null,
  ) {
    act(() =>
      root.render(
        <Harness
          remote={remote}
          thread={thread}
          selectedThreadId={thread?.thread.threadId ?? null}
          draftProjectRootKey={draftProjectRootKey}
        />,
      ),
    );
  }
  it("uses task checkout for selected conversations and project checkout for drafts, never pending/local fallback", () => {
    expect(remoteSurfaceScope(remoteThread, "thread", "remote:other:r:p")).toEqual({
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
      taskId: "latest",
    });
    expect(remoteSurfaceScope(null, null, "remote:server:runner:project")).toEqual({
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
    });
    expect(
      remoteSurfaceScope(
        null,
        "remote-thread:server:runner:pending",
        "remote:server:runner:project",
      ),
    ).toBeNull();
    expect(
      remoteSurfaceScope(surfaceThreadView(), "local", "remote:server:runner:project"),
    ).toBeNull();
    expect(remoteSurfaceScope(null, null, "remote:server:%72unner:project")).toBeNull();
  });
  it("revokes capability publication on project A → B → A and on disconnect", async () => {
    const port = gateway();
    const pending: Array<(capabilities: RemoteSurfaceCapabilities) => void> = [];
    vi.mocked(port.capabilities).mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const remote = context(port);
    render(remote);
    render(remote, "remote:server:runner:other");
    render(remote);
    await act(async () => pending[0]!(yes));
    expect(current?.gateway).toBeNull();
    await act(async () => pending[1]!(yes));
    expect(current?.gateway).toBeNull();
    await act(async () => pending[2]!(yes));
    expect(current?.gateway).toBe(port);
    render(context(port, { ...connected, connected: false }));
    expect(current?.gateway).toBeNull();
    expect(current?.capabilities.files).toBe(false);
  });
  it("keeps pane identity on continuation while changing exact physical task scope", async () => {
    const port = gateway();
    vi.mocked(port.capabilities).mockResolvedValue(yes);
    render(context(port), "remote:server:runner:project", remoteThread);
    await act(async () => Promise.resolve());
    const paneKey = current?.paneKey;
    expect(port.capabilities).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: "latest" }),
    );
    render(context(port), "remote:server:runner:project", {
      ...remoteThread,
      execution: { ...remoteThread.execution, latestTaskId: "next" },
    });
    expect(current?.paneKey).toBe(paneKey);
    expect(current?.gateway).toBeNull();
    await act(async () => Promise.resolve());
    expect(port.capabilities).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "next" }));
    expect(current?.scope.taskId).toBe("next");
  });
  it("does not reuse capabilities when an endpoint is replaced under the same server ID", async () => {
    const port = gateway();
    vi.mocked(port.capabilities)
      .mockResolvedValueOnce(yes)
      .mockRejectedValueOnce(new Error("not supported"));
    render(context(port));
    await act(async () => Promise.resolve());
    expect(current?.gateway).toBe(port);
    render(context(port, { ...connected, host: "replacement" }));
    expect(current?.gateway).toBeNull();
    await act(async () => Promise.resolve());
    expect(current?.gateway).toBeNull();
    expect(current?.message).toContain("unavailable");
  });
});
