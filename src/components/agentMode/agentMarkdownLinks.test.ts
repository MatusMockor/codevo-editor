// @vitest-environment jsdom
import type { KeyboardEvent, MouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentMarkdownLink } from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  activateAgentMarkdownLink,
  agentLocalFileLinkScope,
  type AgentLocalFileLinkPort,
  type AgentMarkdownLinkPorts,
} from "./agentMarkdownLinks";

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

function localPort() {
  const open = vi.fn<AgentLocalFileLinkPort["open"]>();
  const reject = vi.fn<AgentLocalFileLinkPort["reject"]>();
  return { open, reject, port: { open, reject } };
}

function ports(
  port: AgentLocalFileLinkPort | null,
  openExternal = vi.fn().mockResolvedValue(undefined),
): AgentMarkdownLinkPorts {
  return {
    openExternal,
    localFiles: agentLocalFileLinkScope(port, {
      remote: false,
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
    expect(local.open).toHaveBeenCalledWith({ path: `${ROOT}/src/server.ts`, line: 12, column: 3 });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("resolves a relative local file against the worktree before the repository", () => {
    const local = localPort();
    const scope = agentLocalFileLinkScope(local.port, {
      remote: false,
      repositoryRoot: ROOT,
      worktreePath: `${ROOT}/.worktrees/agt-1`,
    });
    const { event } = click(turn("src/a.ts#L7", null));
    activateAgentMarkdownLink(event, parseAgentMarkdownLink("src/a.ts#L7"), {
      openExternal: vi.fn(),
      localFiles: scope,
    });
    expect(local.open).toHaveBeenCalledWith({
      path: `${ROOT}/.worktrees/agt-1/src/a.ts`,
      line: 7,
      column: null,
    });
  });

  it("rejects visibly and never opens a local file outside every thread root", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const local = localPort();
    const preventDefault = activate("/etc/passwd", ports(local.port, openExternal));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(local.open).not.toHaveBeenCalled();
    expect(local.reject).toHaveBeenCalledExactlyOnceWith("outsideRoots");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("rejects a sibling-prefix path and a normalized traversal out of the root", () => {
    const local = localPort();
    activate("/workspace/app-docs/readme.md", ports(local.port));
    activate(`${ROOT}/src/../../secret.txt`, ports(local.port));
    expect(local.open).not.toHaveBeenCalled();
    expect(local.reject.mock.calls).toEqual([["outsideRoots"], ["outsideRoots"]]);
  });

  it.each([`${ROOT}/a.ts`, "src/a.ts", "/etc/passwd"])(
    "rejects local link %s of a remote thread with the remote reason",
    (href) => {
      const local = localPort();
      const scope = agentLocalFileLinkScope(local.port, {
        remote: true,
        repositoryRoot: ROOT,
        worktreePath: null,
      });
      const { event } = click(turn(href, null));
      activateAgentMarkdownLink(event, parseAgentMarkdownLink(href), {
        openExternal: vi.fn(),
        localFiles: scope,
      });
      expect(local.open).not.toHaveBeenCalled();
      expect(local.reject).toHaveBeenCalledExactlyOnceWith("remoteThread");
    },
  );

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
    expect(local.open).toHaveBeenCalledWith({ path: `${ROOT}/src/a.ts`, line: 4, column: null });
  });

  it("ignores unsafe links without preventing or opening anything", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const local = localPort();
    const preventDefault = activate("javascript:alert(1)", ports(local.port, openExternal));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(local.open).not.toHaveBeenCalled();
    expect(local.reject).not.toHaveBeenCalled();
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
      path: `${ROOT}/docs/design/page.html`,
      line: null,
      column: null,
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
