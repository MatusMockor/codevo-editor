import { describe, expect, it } from "vitest";
import { TauriForgeUrlOpener, TauriPullRequestGateway } from "./tauriPullRequestGateway";

function recordingOpener() {
  const opened: string[] = [];
  const opener = new TauriForgeUrlOpener(async (url) => {
    opened.push(url);
  });
  return { opened, opener };
}

describe("TauriForgeUrlOpener", () => {
  it("opens https github.com and gitlab.com addresses", async () => {
    const { opened, opener } = recordingOpener();

    await opener.openExternal("https://github.com/acme/orders-api/pull/42");
    await opener.openExternal("https://gitlab.com/acme/api/-/merge_requests/3");

    expect(opened).toEqual([
      "https://github.com/acme/orders-api/pull/42",
      "https://gitlab.com/acme/api/-/merge_requests/3",
    ]);
  });

  it("rejects non-forge, non-https and malformed addresses without opening", async () => {
    const { opened, opener } = recordingOpener();
    const hostile = [
      "javascript:alert(1)",
      "http://github.com/acme/orders-api/pull/42",
      "https://evil.example/acme",
      "https://github.com.evil.example/acme",
      "https://user@evil.example/github.com",
      "file:///etc/passwd",
      "not a url",
      `https://github.com/${"a".repeat(2_100)}`,
    ];

    for (const url of hostile) {
      await expect(opener.openExternal(url)).rejects.toThrow();
    }
    expect(opened).toEqual([]);
  });
});

describe("TauriPullRequestGateway", () => {
  it("routes context loads through the validated contract", async () => {
    const commands: string[] = [];
    const gateway = new TauriPullRequestGateway(async (command) => {
      commands.push(command);
      return {
        headBranch: "feat/keys",
        defaultBase: "main",
        base: "main",
        commitsAhead: 0,
        filesChanged: 0,
        unpushedCommits: 0,
        hasUpstream: false,
        forge: null,
        cliAvailable: false,
        commitSubjects: [],
        compareUrl: null,
      };
    });

    const context = await gateway.getContext({
      repositoryRoot: "/repo",
      worktreePath: null,
      base: null,
    });

    expect(commands).toEqual(["get_pull_request_context"]);
    expect(context.forge).toBeNull();
  });
});
