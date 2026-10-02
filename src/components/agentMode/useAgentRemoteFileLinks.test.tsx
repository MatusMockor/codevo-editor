// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import {
  agentLocalFileLinkFailure,
  agentLocalFileLinkPlace,
} from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceCapabilities,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import type { AgentRemoteSurface } from "./agentRemoteSurface";
import type { AgentRemoteFileOpenOutcome } from "./agentRemoteFileLinks";
import {
  REMOTE_FILE_REVEAL_ACCEPT_TIMEOUT_MS,
  useAgentRemoteFileLinks,
  type AgentRemoteFileLinks,
} from "./useAgentRemoteFileLinks";

const A: RemoteSurfaceScope = {
  serverId: "linux",
  runnerId: "runner",
  projectId: "app",
  taskId: "task-a",
};
const B: RemoteSurfaceScope = { ...A, taskId: "task-b" };
const TARGET = { path: "src/app.ts", line: 12, column: null };
const ALL = { files: true, history: true, terminal: true };

let root: Root;
let links: AgentRemoteFileLinks;
const notices: AgentTasksNotice[] = [];
const openFiles = vi.fn();

function surface(
  scope: RemoteSurfaceScope,
  capabilities: RemoteSurfaceCapabilities = ALL,
  gateway: RemoteRunnerSurfacesGateway | null = {} as RemoteRunnerSurfacesGateway,
): AgentRemoteSurface {
  return { paneKey: "remote-thread:pane", scope, gateway, capabilities };
}

function Probe({ current }: { readonly current: AgentRemoteSurface | null }) {
  links = useAgentRemoteFileLinks({
    surface: current,
    openFiles,
    reportNotice: (notice) => notices.push(notice),
  });
  return null;
}

function render(current: AgentRemoteSurface | null) {
  act(() => root.render(<Probe current={current} />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  notices.length = 0;
  openFiles.mockReset();
});

afterEach(() => act(() => root.unmount()));

it("opens the Files surface and hands the exact request to the matching panel", async () => {
  render(surface(A));
  let opened!: Promise<AgentRemoteFileOpenOutcome>;
  act(() => {
    opened = links.port.open({ scope: A, target: TARGET });
  });

  expect(openFiles).toHaveBeenCalledOnce();
  expect(links.reveal?.scope).toEqual(A);
  expect(links.reveal?.target).toEqual(TARGET);
  act(() => links.reveal?.settle("opened"));
  await expect(opened).resolves.toBe("opened");
  expect(links.reveal).toBeNull();
});

it("refuses truthfully when the server does not offer files", async () => {
  render(surface(A, { ...ALL, files: false }));
  await expect(links.port.open({ scope: A, target: TARGET })).resolves.toBe("filesUnavailable");
  render(surface(A, ALL, null));
  await expect(links.port.open({ scope: A, target: TARGET })).resolves.toBe("filesUnavailable");
  expect(openFiles).not.toHaveBeenCalled();
  expect(links.reveal).toBeNull();
});

it("ignores a click captured for another thread checkout", async () => {
  render(surface(B));
  await expect(links.port.open({ scope: A, target: TARGET })).resolves.toBe("superseded");
  render(null);
  await expect(links.port.open({ scope: A, target: TARGET })).resolves.toBe("superseded");
  expect(openFiles).not.toHaveBeenCalled();
});

it("supersedes a pending request when the thread checkout changes, including A to B to A", async () => {
  render(surface(A));
  let opened!: Promise<AgentRemoteFileOpenOutcome>;
  act(() => {
    opened = links.port.open({ scope: A, target: TARGET });
  });
  const stale = links.reveal;
  render(surface(B));
  await expect(opened).resolves.toBe("superseded");
  expect(links.reveal).toBeNull();
  render(surface(A));
  expect(links.reveal).toBeNull();
  act(() => stale?.settle("opened"));
  expect(links.reveal).toBeNull();
});

it("supersedes the previous click and settles pending work on unmount", async () => {
  render(surface(A));
  let first!: Promise<AgentRemoteFileOpenOutcome>;
  let second!: Promise<AgentRemoteFileOpenOutcome>;
  act(() => {
    first = links.port.open({ scope: A, target: TARGET });
  });
  act(() => {
    second = links.port.open({ scope: A, target: { ...TARGET, line: 30 } });
  });
  await expect(first).resolves.toBe("superseded");
  expect(links.reveal?.target.line).toBe(30);
  act(() => root.unmount());
  await expect(second).resolves.toBe("superseded");
  root = createRoot(document.createElement("div"));
});

it("settles a pending request when the server stops offering files", async () => {
  render(surface(A));
  let opened!: Promise<AgentRemoteFileOpenOutcome>;
  act(() => {
    opened = links.port.open({ scope: A, target: TARGET });
  });
  render(surface(A, ALL, null));
  await expect(opened).resolves.toBe("filesUnavailable");
  expect(links.reveal).toBeNull();
  render(surface(A));
  expect(links.reveal).toBeNull();
});

it("supersedes a pending request even when the next click is refused", async () => {
  render(surface(A));
  let first!: Promise<AgentRemoteFileOpenOutcome>;
  act(() => {
    first = links.port.open({ scope: A, target: TARGET });
  });
  render(surface(A, { ...ALL, files: false }));
  await expect(first).resolves.toBe("filesUnavailable");
  await expect(links.port.open({ scope: A, target: TARGET })).resolves.toBe("filesUnavailable");
  expect(links.reveal).toBeNull();
});

it("refuses truthfully when no Files panel accepts the request in time", async () => {
  vi.useFakeTimers();
  try {
    render(surface(A));
    let opened!: Promise<AgentRemoteFileOpenOutcome>;
    act(() => {
      opened = links.port.open({ scope: A, target: TARGET });
    });
    act(() => vi.advanceTimersByTime(REMOTE_FILE_REVEAL_ACCEPT_TIMEOUT_MS - 1));
    expect(links.reveal).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    await expect(opened).resolves.toBe("filesUnavailable");
    expect(links.reveal).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("stops the acceptance timeout once the Files panel takes the request", async () => {
  vi.useFakeTimers();
  try {
    render(surface(A));
    let opened!: Promise<AgentRemoteFileOpenOutcome>;
    act(() => {
      opened = links.port.open({ scope: A, target: TARGET });
    });
    act(() => links.reveal?.accept());
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(REMOTE_FILE_REVEAL_ACCEPT_TIMEOUT_MS * 3));
    expect(links.reveal).not.toBeNull();
    act(() => links.reveal?.settle("opened"));
    await expect(opened).resolves.toBe("opened");
  } finally {
    vi.useRealTimers();
  }
});

it("clears the acceptance timeout when a request is superseded", async () => {
  vi.useFakeTimers();
  try {
    render(surface(A));
    let opened!: Promise<AgentRemoteFileOpenOutcome>;
    act(() => {
      opened = links.port.open({ scope: A, target: TARGET });
    });
    render(surface(B));
    await expect(opened).resolves.toBe("superseded");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("reports failures as dismissible info notices", () => {
  render(surface(A));
  const place = agentLocalFileLinkPlace("worktree", "/srv/app");
  act(() => links.port.report(agentLocalFileLinkFailure("notFound", "src/gone.ts", place)));
  expect(notices).toEqual([
    { kind: "info", message: "src/gone.ts isn't in this worktree (app).", action: null },
  ]);
});
