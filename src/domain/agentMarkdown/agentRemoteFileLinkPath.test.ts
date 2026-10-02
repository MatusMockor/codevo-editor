import { describe, expect, it } from "vitest";
import { parseAgentMarkdownLink, type AgentLocalFileLink } from "./agentMarkdownLink";
import {
  MAX_AGENT_REMOTE_ANCHOR_SEGMENTS,
  NO_AGENT_REMOTE_FILE_LINK_ANCHORS,
  resolveAgentRemoteFileLink,
  type AgentRemoteFileLinkAnchors,
} from "./agentRemoteFileLinkPath";

const WORKSPACE = "9f0c2a4e-7d1b-4c3a-8e2f-1a2b3c4d5e6f";
const WORKTREE: AgentRemoteFileLinkAnchors = { kind: "worktree", workspaceDirectory: WORKSPACE };
const IN_PLACE: AgentRemoteFileLinkAnchors = { kind: "project", projectDirectory: "app" };

function fileLink(href: string): AgentLocalFileLink {
  const link = parseAgentMarkdownLink(href);
  if (link.kind !== "localFile") throw new Error(`${href} is not a file link`);
  return link;
}

function absolute(path: string): AgentLocalFileLink {
  return { kind: "localFile", anchor: "absolute", location: { path, line: 4, column: null } };
}

describe("resolveAgentRemoteFileLink", () => {
  it.each([
    ["src/app.ts:42", { path: "src/app.ts", line: 42, column: null }],
    ["./src/app.ts#L7C2", { path: "src/app.ts", line: 7, column: 2 }],
    ["src/../lib/a.ts", { path: "lib/a.ts", line: null, column: null }],
    ["README.md", { path: "README.md", line: null, column: null }],
  ])("resolves relative link %s against the remote checkout root", (href, target) => {
    expect(resolveAgentRemoteFileLink(fileLink(href), NO_AGENT_REMOTE_FILE_LINK_ANCHORS)).toEqual({
      kind: "server",
      target,
    });
  });

  it("anchors an absolute worktree path at the runner workspace directory", () => {
    const href = `/var/lib/codevo/workspaces/${WORKSPACE}/src/app.ts:12:3`;
    expect(resolveAgentRemoteFileLink(fileLink(href), WORKTREE)).toEqual({
      kind: "server",
      target: { path: "src/app.ts", line: 12, column: 3 },
    });
  });

  it("anchors a file URL with a line suffix", () => {
    const href = `file:///srv/ws/${WORKSPACE}/lib/a.ts:9`;
    expect(resolveAgentRemoteFileLink(fileLink(href), WORKTREE)).toEqual({
      kind: "server",
      target: { path: "lib/a.ts", line: 9, column: null },
    });
  });

  it("anchors an in-place path at the known project directory", () => {
    expect(resolveAgentRemoteFileLink(fileLink("/home/me/code/app/src/a.ts#L5"), IN_PLACE)).toEqual(
      { kind: "server", target: { path: "src/a.ts", line: 5, column: null } },
    );
  });

  it("never anchors a worktree thread on a source-checkout project folder", () => {
    expect(resolveAgentRemoteFileLink(absolute("/home/me/app/src/a.ts"), WORKTREE)).toEqual({
      kind: "absolute",
    });
  });

  it("anchors a worktree thread only at its workspace even when the project name repeats", () => {
    const path = `/srv/app/ws/${WORKSPACE}/app/x.ts`;
    expect(resolveAgentRemoteFileLink(absolute(path), WORKTREE)).toEqual({
      kind: "server",
      target: { path: "app/x.ts", line: 4, column: null },
    });
  });

  it("never anchors an in-place thread on a workspace-looking segment", () => {
    const path = `/srv/ws/${WORKSPACE}/src/a.ts`;
    expect(
      resolveAgentRemoteFileLink(absolute(path), { kind: "project", projectDirectory: null }),
    ).toEqual({ kind: "absolute" });
  });

  it("uses the first occurrence of a repeated anchor segment", () => {
    expect(
      resolveAgentRemoteFileLink(absolute("/srv/app/packages/app/index.ts"), IN_PLACE),
    ).toEqual({ kind: "server", target: { path: "packages/app/index.ts", line: 4, column: null } });
  });

  it.each([
    ["/srv/other/src/a.ts", WORKTREE],
    ["/srv/other/src/a.ts", IN_PLACE],
    ["/srv/app/src/a.ts", NO_AGENT_REMOTE_FILE_LINK_ANCHORS],
    ["/srv/apps/src/a.ts", IN_PLACE],
  ])("keeps %s unanchored without an exact segment match", (path, anchors) => {
    expect(resolveAgentRemoteFileLink(absolute(path), anchors)).toEqual({ kind: "absolute" });
  });

  it("never anchors oversized absolute paths", () => {
    const deep = `/${Array.from({ length: MAX_AGENT_REMOTE_ANCHOR_SEGMENTS }, () => "d").join("/")}/app/a.ts`;
    expect(resolveAgentRemoteFileLink(absolute(deep), IN_PLACE)).toEqual({ kind: "absolute" });
  });

  it.each(["/srv/app", "/srv/app/", "/srv/app/src/.."])(
    "reports a link to the checkout root %s as a folder",
    (path) => {
      expect(resolveAgentRemoteFileLink(absolute(path), IN_PLACE)).toEqual({
        kind: "checkoutRoot",
      });
    },
  );

  it.each(["/srv/app/../etc/passwd", "/srv/app/src/../../secret"])(
    "rejects %s whose remainder escapes the anchored checkout",
    (path) => {
      expect(resolveAgentRemoteFileLink(absolute(path), IN_PLACE)).toEqual({
        kind: "unsupported",
      });
    },
  );

  it.each(["/srv/app/.git/config", "/srv/app/a:b.ts"])(
    "validates the anchored remainder of %s like the server",
    (path) => {
      expect(resolveAgentRemoteFileLink(absolute(path), IN_PLACE)).toEqual({
        kind: "unsupported",
      });
    },
  );

  it.each([".git/config", "src/.GIT/HEAD", "src/a:b.ts", `${"x".repeat(4097)}.ts`])(
    "refuses relative %s that the server file surface would reject",
    (path) => {
      const link: AgentLocalFileLink = {
        kind: "localFile",
        anchor: "relative",
        location: { path, line: 1, column: null },
      };
      expect(resolveAgentRemoteFileLink(link, IN_PLACE)).toEqual({ kind: "unsupported" });
    },
  );

  it("does not produce relative links that escape the checkout", () => {
    expect(parseAgentMarkdownLink("../outside.ts").kind).toBe("none");
    expect(parseAgentMarkdownLink("src/../../outside.ts").kind).toBe("none");
  });
});
