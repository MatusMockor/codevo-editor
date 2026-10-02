// @vitest-environment jsdom
import type { KeyboardEvent, MouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentLocalFileLinkFailure,
  AgentLocalFileOpenOutcome,
} from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import { parseAgentMarkdownLink } from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  activateAgentMarkdownLink,
  agentLocalFileLinkNotice,
  agentLocalFileLinkScope,
  agentServerLinkOpener,
  agentThreadLinks,
  type AgentLocalFileLinkMemory,
  type AgentLocalFileLinkPort,
  type AgentMarkdownLinkPorts,
} from "./agentMarkdownLinks";
import {
  agentRemoteFileLinkScope,
  type AgentRemoteFileLinkPort,
  type AgentRemoteFileOpenOutcome,
} from "./agentRemoteFileLinks";

const ROOT = "/workspace/app";

function turn(href: string, artifactPath: string | null): HTMLAnchorElement {
  const article = document.createElement("article");
  article.dataset.agentTurn = "agt-2-0a1b";
  const link = document.createElement("a");
  link.setAttribute("href", href);
  article.append(link);
  if (artifactPath !== null) {
    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.dataset.agentArtifactPath = artifactPath;
    disclosure.setAttribute("aria-expanded", "false");
    article.append(disclosure);
  }
  document.body.append(article);
  return link;
}

function click(link: HTMLAnchorElement, button = 0) {
  const preventDefault = vi.fn();
  const event = {
    button,
    currentTarget: link,
    target: link,
    preventDefault,
  } as unknown as MouseEvent<HTMLAnchorElement>;
  return { event, preventDefault };
}

function localPort(outcome: AgentLocalFileOpenOutcome = "opened") {
  const open = vi.fn<AgentLocalFileLinkPort["open"]>(async () => outcome);
  const report = vi.fn<AgentLocalFileLinkPort["report"]>();
  return { open, report, port: { open, report } };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function memory(): AgentLocalFileLinkMemory & {
  readonly failures: Map<string, AgentLocalFileLinkFailure>;
} {
  const failures = new Map<string, AgentLocalFileLinkFailure>();
  return {
    failures,
    failureFor: (link) => failures.get(link.location.path) ?? null,
    remember: (link, failure) => {
      failures.delete(link.location.path);
      if (failure !== null) failures.set(link.location.path, failure);
    },
  };
}

const REMOTE_SCOPE = { serverId: "linux", runnerId: "runner", projectId: "app", taskId: "task-2" };

function remotePort(outcome: AgentRemoteFileOpenOutcome = "opened") {
  const open = vi.fn<AgentRemoteFileLinkPort["open"]>(async () => outcome);
  const report = vi.fn<AgentRemoteFileLinkPort["report"]>();
  return { open, report, port: { open, report } };
}

function remoteScope(
  port: AgentRemoteFileLinkPort,
  isolation: "worktree" | "in-place" = "worktree",
  repositoryLabel = "Server app",
) {
  return agentRemoteFileLinkScope(port, {
    execution: {
      serverId: "linux",
      runnerId: "runner",
      projectId: "app",
      conversationId: "conv-1",
      latestTaskId: "task-2",
    },
    isolation,
    repositoryLabel,
  });
}

function activateRemote(
  href: string,
  port: AgentRemoteFileLinkPort,
  scope: ReturnType<typeof remoteScope> = remoteScope(port),
) {
  const { event } = click(turn(href, null));
  activateAgentMarkdownLink(event, parseAgentMarkdownLink(href), {
    openExternal: vi.fn(),
    localFiles: scope,
  });
}

function ports(
  port: AgentLocalFileLinkPort | null,
  openExternal = vi.fn().mockResolvedValue(undefined),
): AgentMarkdownLinkPorts {
  return {
    openExternal,
    localFiles: agentLocalFileLinkScope(port, {
      repositoryRoot: ROOT,
      worktreePath: null,
    }),
  };
}

function activate(
  href: string,
  linkPorts: AgentMarkdownLinkPorts,
  artifactPath: string | null = null,
) {
  const anchor = turn(href, artifactPath);
  const { event, preventDefault } = click(anchor);
  activateAgentMarkdownLink(event, parseAgentMarkdownLink(href), linkPorts);
  return preventDefault;
}

describe("activateAgentMarkdownLink", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens safe external links only through the external opener", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const local = localPort();
    const preventDefault = activate("https://example.com", ports(local.port, openExternal));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    expect(local.open).not.toHaveBeenCalled();
  });

  it("opens an absolute local file inside the thread root with its position", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const local = localPort();
    activate(`${ROOT}/src/server.ts:12:3`, ports(local.port, openExternal));
    expect(local.open).toHaveBeenCalledWith({
      location: { path: `${ROOT}/src/server.ts`, line: 12, column: 3 },
      root: ROOT,
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("resolves a relative local file against the worktree before the repository", () => {
    const local = localPort();
    const scope = agentLocalFileLinkScope(local.port, {
      repositoryRoot: ROOT,
      worktreePath: `${ROOT}/.worktrees/agt-1`,
    });
    const { event } = click(turn("src/a.ts#L7", null));
    activateAgentMarkdownLink(event, parseAgentMarkdownLink("src/a.ts#L7"), {
      openExternal: vi.fn(),
      localFiles: scope,
    });
    expect(local.open).toHaveBeenCalledWith({
      location: { path: `${ROOT}/.worktrees/agt-1/src/a.ts`, line: 7, column: null },
      root: `${ROOT}/.worktrees/agt-1`,
    });
  });

  it("refuses visibly and never opens a local file outside every thread root", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const local = localPort();
    const preventDefault = activate("/etc/passwd", ports(local.port, openExternal));
    await settle();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(local.open).not.toHaveBeenCalled();
    expect(local.report).toHaveBeenCalledExactlyOnceWith({
      kind: "outsideProject",
      path: "/etc/passwd",
      place: { kind: "project", label: "app" },
    });
    expect(agentLocalFileLinkNotice(local.report.mock.calls[0]![0])).toEqual({
      kind: "info",
      message: "/etc/passwd is outside this project (app), so it wasn't opened.",
      action: null,
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses a sibling-prefix path and a normalized traversal out of the root", async () => {
    const local = localPort();
    activate("/workspace/app-docs/readme.md", ports(local.port));
    activate(`${ROOT}/src/../../secret.txt`, ports(local.port));
    await settle();
    expect(local.open).not.toHaveBeenCalled();
    expect(local.report.mock.calls.map(([failure]) => failure.kind)).toEqual([
      "outsideProject",
      "outsideProject",
    ]);
  });

  it.each<[AgentLocalFileOpenOutcome, string]>([
    ["notFound", "src/environment.prod.ts isn't in this project (app)."],
    ["unreadable", "src/environment.prod.ts exists but couldn't be read."],
    ["failed", "src/environment.prod.ts couldn't be opened."],
  ])("reports a %s open with the project-relative path", async (outcome, message) => {
    const local = localPort(outcome);
    activate(`${ROOT}/src/environment.prod.ts`, ports(local.port));
    await settle();
    expect(local.report).toHaveBeenCalledOnce();
    expect(agentLocalFileLinkNotice(local.report.mock.calls[0]![0]).message).toBe(message);
  });

  it("names the worktree, not the repository, when the link resolved inside a worktree", async () => {
    const local = localPort("notFound");
    const scope = agentLocalFileLinkScope(local.port, {
      repositoryRoot: ROOT,
      worktreePath: `${ROOT}/.worktrees/agt-1`,
    });
    const { event } = click(turn("src/a.ts", null));
    activateAgentMarkdownLink(event, parseAgentMarkdownLink("src/a.ts"), {
      openExternal: vi.fn(),
      localFiles: scope,
    });
    await settle();
    expect(agentLocalFileLinkNotice(local.report.mock.calls[0]![0]).message).toBe(
      "src/a.ts isn't in this worktree (agt-1).",
    );
  });

  it("treats a rejected opener as a failed open", async () => {
    const local = localPort();
    local.open.mockRejectedValueOnce(new Error("boom"));
    activate("src/a.ts", ports(local.port));
    await settle();
    expect(local.report).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      path: "src/a.ts",
      place: { kind: "project", label: "app" },
    });
  });

  it("bounds a very long path in the failure", async () => {
    const local = localPort("notFound");
    const long = `src/${"deep/".repeat(60)}file.ts`;
    activate(long, ports(local.port));
    await settle();
    const failure = local.report.mock.calls[0]![0];
    expect(Array.from(failure.path).length).toBeLessThanOrEqual(96);
    expect(failure.path.startsWith("src/deep/")).toBe(true);
    expect(failure.path.endsWith("file.ts")).toBe(true);
    expect(failure.path).toContain("…");
  });

  it("remembers a failed link and does not repeat the same notice, but forgets it once it opens", async () => {
    const local = localPort("notFound");
    const remembered = memory();
    const linkPorts = { ...ports(local.port), memory: remembered };
    activate("src/gone.ts", linkPorts);
    await settle();
    expect(remembered.failures.get("src/gone.ts")?.kind).toBe("notFound");
    activate("src/gone.ts", linkPorts);
    await settle();
    expect(local.open).toHaveBeenCalledTimes(2);
    expect(local.report).toHaveBeenCalledOnce();

    local.open.mockResolvedValueOnce("opened");
    activate("src/gone.ts", linkPorts);
    await settle();
    expect(remembered.failures.has("src/gone.ts")).toBe(false);
    expect(local.report).toHaveBeenCalledOnce();
  });

  it("opens an absolute link inside the thread's runner worktree relative to that worktree", async () => {
    const remote = remotePort();
    activateRemote("/var/lib/runner/workspaces/conv-1/src/server.ts:8", remote.port);
    await settle();
    expect(remote.open).toHaveBeenCalledExactlyOnceWith({
      scope: REMOTE_SCOPE,
      target: { path: "src/server.ts", line: 8, column: null },
    });
    expect(remote.report).not.toHaveBeenCalled();
  });

  it("reports a link to the worktree root itself without contacting the server", async () => {
    const remote = remotePort();
    activateRemote("/var/lib/runner/workspaces/conv-1", remote.port);
    await settle();
    expect(remote.open).not.toHaveBeenCalled();
    expect(agentLocalFileLinkNotice(remote.report.mock.calls[0]![0]).message).toBe(
      "/var/lib/runner/workspaces/conv-1 is the folder of this worktree (Server app), not a file.",
    );
  });

  it("anchors in-place threads at a project folder named by the runner", async () => {
    const remote = remotePort();
    const scope = remoteScope(remote.port, "in-place", "app");
    activateRemote("/home/me/code/app/src/a.ts:3", remote.port, scope);
    activateRemote("/etc/hosts", remote.port, scope);
    await settle();
    expect(remote.open).toHaveBeenCalledExactlyOnceWith({
      scope: REMOTE_SCOPE,
      target: { path: "src/a.ts", line: 3, column: null },
    });
    expect(agentLocalFileLinkNotice(remote.report.mock.calls[0]![0]).message).toBe(
      "Server threads can only open files inside this project (app), so /etc/hosts wasn't opened.",
    );
  });

  it("never maps a source-checkout path into a worktree thread's copy", async () => {
    const remote = remotePort();
    activateRemote(
      "/home/me/code/app/src/a.ts",
      remote.port,
      remoteScope(remote.port, "worktree", "app"),
    );
    await settle();
    expect(remote.open).not.toHaveBeenCalled();
    expect(remote.report.mock.calls.map(([failure]) => failure.kind)).toEqual([
      "serverAbsolutePath",
    ]);
  });

  it("opens a relative link of a server thread in its exact remote checkout at the line", async () => {
    const remote = remotePort();
    activateRemote("./src/server.ts:12:3", remote.port);
    await settle();
    expect(remote.open).toHaveBeenCalledExactlyOnceWith({
      scope: REMOTE_SCOPE,
      target: { path: "src/server.ts", line: 12, column: 3 },
    });
    expect(remote.report).not.toHaveBeenCalled();
  });

  it.each([
    [
      "/srv/app/src/a.ts",
      "serverAbsolutePath",
      "Server threads can only open files inside this worktree (Server app), so /srv/app/src/a.ts wasn't opened.",
    ],
    [
      `file://${ROOT}/a.ts`,
      "serverAbsolutePath",
      `Server threads can only open files inside this worktree (Server app), so ${ROOT}/a.ts wasn't opened.`,
    ],
    [
      "src/.git/config",
      "outsideProject",
      "src/.git/config is outside this worktree (Server app), so it wasn't opened.",
    ],
    [
      "src/a:b.ts",
      "outsideProject",
      "src/a:b.ts is outside this worktree (Server app), so it wasn't opened.",
    ],
  ])("refuses server link %s before contacting the server", async (href, kind, message) => {
    const remote = remotePort();
    activateRemote(href, remote.port);
    await settle();
    expect(remote.open).not.toHaveBeenCalled();
    expect(remote.report.mock.calls.map(([failure]) => failure.kind)).toEqual([kind]);
    expect(agentLocalFileLinkNotice(remote.report.mock.calls[0]![0]).message).toBe(message);
  });

  it.each([
    ["notFound", "src/gone.ts isn't in this worktree (Server app)."],
    ["notRegularFile", "src/gone.ts isn't a regular text file on the server."],
    ["unreadable", "src/gone.ts exists but couldn't be read."],
    ["saveInProgress", "Wait for the server file save to finish before opening src/gone.ts."],
    ["failed", "src/gone.ts couldn't be opened."],
    [
      "unsavedChanges",
      "Save or discard your unsaved server file edits before opening src/gone.ts.",
    ],
    [
      "filesUnavailable",
      "Server files aren't available for this thread right now, so src/gone.ts wasn't opened.",
    ],
  ] as const)("reports the server outcome %s truthfully", async (outcome, message) => {
    const remote = remotePort(outcome);
    activateRemote("src/gone.ts", remote.port);
    await settle();
    expect(remote.report).toHaveBeenCalledOnce();
    expect(agentLocalFileLinkNotice(remote.report.mock.calls[0]![0]).message).toBe(message);
  });

  it("stays silent for a superseded server open and for a rejected port", async () => {
    const superseded = remotePort("superseded");
    activateRemote("src/a.ts", superseded.port);
    await settle();
    expect(superseded.report).not.toHaveBeenCalled();
    const broken = remotePort();
    broken.open.mockRejectedValueOnce(new Error("boom"));
    activateRemote("src/a.ts", broken.port);
    await settle();
    expect(broken.report.mock.calls.map(([failure]) => failure.kind)).toEqual(["failed"]);
  });

  it("reports transient server refusals on every click without marking the link", async () => {
    const remote = remotePort("unsavedChanges");
    const remembered = memory();
    const scope = remoteScope(remote.port);
    for (let attempt = 0; attempt < 2; attempt++) {
      const { event } = click(turn("src/a.ts", null));
      activateAgentMarkdownLink(event, parseAgentMarkdownLink("src/a.ts"), {
        openExternal: vi.fn(),
        localFiles: scope,
        memory: remembered,
      });
      await settle();
    }
    expect(remote.report).toHaveBeenCalledTimes(2);
    expect(remembered.failures.size).toBe(0);
  });

  it("opens a local file from an Enter key activation", () => {
    const local = localPort();
    const anchor = turn("src/a.ts:4", null);
    const preventDefault = vi.fn();
    const event = {
      key: "Enter",
      currentTarget: anchor,
      target: anchor,
      preventDefault,
    } as unknown as KeyboardEvent<HTMLAnchorElement>;
    activateAgentMarkdownLink(event, parseAgentMarkdownLink("src/a.ts:4"), ports(local.port));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(local.open).toHaveBeenCalledWith({
      location: { path: `${ROOT}/src/a.ts`, line: 4, column: null },
      root: ROOT,
    });
  });

  it("ignores unsafe links without preventing or opening anything", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const local = localPort();
    const preventDefault = activate("javascript:alert(1)", ports(local.port, openExternal));
    await settle();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(local.open).not.toHaveBeenCalled();
    expect(local.report).not.toHaveBeenCalled();
  });

  it("ignores secondary-button clicks", () => {
    const local = localPort();
    const anchor = turn(`${ROOT}/a.ts`, null);
    const { event, preventDefault } = click(anchor, 2);
    activateAgentMarkdownLink(event, parseAgentMarkdownLink(`${ROOT}/a.ts`), ports(local.port));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(local.open).not.toHaveBeenCalled();
  });

  it("expands this turn's artifact disclosure instead of opening the file", () => {
    const local = localPort();
    const anchor = turn("docs/design/page.html", "docs/design/page.html");
    const disclosure = document.querySelector<HTMLButtonElement>("[data-agent-artifact-path]")!;
    const clicked = vi.fn(() => disclosure.setAttribute("aria-expanded", "true"));
    disclosure.addEventListener("click", clicked);

    const { event } = click(anchor);
    activateAgentMarkdownLink(
      event,
      parseAgentMarkdownLink("docs/design/page.html"),
      ports(local.port),
    );

    expect(clicked).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(disclosure);
    expect(local.open).not.toHaveBeenCalled();
  });

  it("does not collapse an already expanded disclosure", () => {
    const anchor = turn("docs/design/page.html", "docs/design/page.html");
    const disclosure = document.querySelector<HTMLButtonElement>("[data-agent-artifact-path]")!;
    disclosure.setAttribute("aria-expanded", "true");
    const clicked = vi.fn();
    disclosure.addEventListener("click", clicked);

    const { event } = click(anchor);
    activateAgentMarkdownLink(event, parseAgentMarkdownLink("docs/design/page.html"), ports(null));

    expect(clicked).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(disclosure);
  });

  it("opens the relative file when the turn has no matching artifact", () => {
    const local = localPort();
    const preventDefault = activate("docs/design/page.html", ports(local.port), "docs/other.html");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(local.open).toHaveBeenCalledWith({
      location: { path: `${ROOT}/docs/design/page.html`, line: null, column: null },
      root: ROOT,
    });
  });

  it("never reaches an artifact disclosure belonging to another turn", () => {
    const anchor = turn("docs/design/page.html", null);
    const other = document.createElement("article");
    other.dataset.agentTurn = "agt-3-0a1b";
    const disclosure = document.createElement("button");
    disclosure.dataset.agentArtifactPath = "docs/design/page.html";
    disclosure.setAttribute("aria-expanded", "false");
    other.append(disclosure);
    document.body.append(other);
    const clicked = vi.fn();
    disclosure.addEventListener("click", clicked);

    const { event } = click(anchor);
    activateAgentMarkdownLink(event, parseAgentMarkdownLink("docs/design/page.html"), ports(null));

    expect(clicked).not.toHaveBeenCalled();
  });
});

describe("server thread link opener", () => {
  function opener() {
    const openExternal = vi.fn(async () => undefined);
    const openLoopback = vi.fn(async () => undefined);
    return {
      openExternal,
      openLoopback,
      open: agentServerLinkOpener(openExternal, { openLoopback, titleFor: () => null }),
    };
  }

  it.each([
    "http://localhost:3000/",
    "http://127.0.0.1:5173/app",
    "http://[::1]:3000/",
    "http://0.0.0.0:8080/",
    "http://localhost/",
  ])("routes %s to the server and never to this computer", async (url) => {
    const { open, openExternal, openLoopback } = opener();
    const link = turn(url, null);
    const { event, preventDefault } = click(link);

    activateAgentMarkdownLink(event, parseAgentMarkdownLink(url), {
      openExternal: open,
      localFiles: null,
    });
    await settle();

    expect(preventDefault).toHaveBeenCalled();
    expect(openLoopback).toHaveBeenCalledExactlyOnceWith(url);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses links it cannot parse instead of opening them on this computer", async () => {
    const { open, openExternal, openLoopback } = opener();
    const longUrl = `https://example.com/${"a".repeat(5000)}`;
    await open("http://[bad");
    await open(longUrl);

    expect(openLoopback.mock.calls).toEqual([["http://[bad"], [longUrl]]);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("titles only server links and leaves local threads untouched", async () => {
    const openExternal = vi.fn(async () => undefined);
    const openLoopback = vi.fn(async () => undefined);
    const server = { openLoopback, titleFor: (url: string) => `server ${url}` };

    const local = agentThreadLinks(openExternal, server, false);
    expect(local).toEqual({ openExternal, linkTitle: null });

    const remote = agentThreadLinks(openExternal, server, true);
    expect(remote.linkTitle?.("http://localhost:3000/")).toBe("server http://localhost:3000/");
    expect(remote.linkTitle?.("https://example.com/")).toBeNull();

    const unwired = agentThreadLinks(openExternal, null, true);
    await unwired.openExternal("http://localhost:3000/");
    expect(unwired.linkTitle?.("http://localhost:3000/")).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens other web links unchanged", async () => {
    const { open, openExternal, openLoopback } = opener();
    await open("https://example.com:3000/docs");

    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://example.com:3000/docs");
    expect(openLoopback).not.toHaveBeenCalled();
  });
});
