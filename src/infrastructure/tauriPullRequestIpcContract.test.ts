import { describe, expect, it } from "vitest";
import type { CreatePullRequestRequest } from "../domain/pullRequest";
import {
  CREATE_PULL_REQUEST_IPC_COMMAND,
  GET_PULL_REQUEST_CONTEXT_IPC_COMMAND,
  invokeCreatePullRequestIpc,
  invokeGetPullRequestContextIpc,
  type InvokePullRequestCommand,
} from "./tauriPullRequestIpcContract";

const context = {
  headBranch: "feat/keys",
  defaultBase: "main",
  base: "develop",
  commitsAhead: 1,
  filesChanged: 2,
  unpushedCommits: 0,
  hasUpstream: true,
  forge: "gitlab",
  cliAvailable: false,
  commitSubjects: ["feat: keys"],
  compareUrl: null,
};

const request: CreatePullRequestRequest = {
  repositoryRoot: "/repo",
  worktreePath: "/repo/.worktrees/task-1",
  base: "main",
  title: "  Add keys  ",
  body: "## Why",
  draft: true,
};

function recordingInvoke(result: unknown) {
  const calls: Array<{ command: string; args: unknown }> = [];
  const invoke: InvokePullRequestCommand = async (command, args) => {
    calls.push({ command, args });
    return result;
  };
  return { calls, invoke };
}

describe("pull request IPC contract", () => {
  it("keeps exact command names", () => {
    expect(GET_PULL_REQUEST_CONTEXT_IPC_COMMAND).toBe("get_pull_request_context");
    expect(CREATE_PULL_REQUEST_IPC_COMMAND).toBe("create_pull_request");
  });

  it("sends the validated create request with a trimmed title and parses the receipt", async () => {
    const { calls, invoke } = recordingInvoke({
      url: "https://github.com/acme/orders-api/pull/9",
      forge: "github",
    });

    const receipt = await invokeCreatePullRequestIpc(invoke, request);

    expect(calls).toEqual([
      {
        command: "create_pull_request",
        args: {
          request: {
            repositoryRoot: "/repo",
            worktreePath: "/repo/.worktrees/task-1",
            base: "main",
            title: "Add keys",
            body: "## Why",
            draft: true,
          },
        },
      },
    ]);
    expect(receipt).toEqual({ url: "https://github.com/acme/orders-api/pull/9", forge: "github" });
  });

  it("rejects a multi-line title without invoking", async () => {
    const { calls, invoke } = recordingInvoke(null);

    await expect(invokeCreatePullRequestIpc(invoke, { ...request, title: "a\nb" })).rejects.toThrow(
      "Use a single-line title",
    );
    expect(calls).toEqual([]);
  });

  it("rejects option-like and range bases without invoking", async () => {
    const { calls, invoke } = recordingInvoke(null);

    await expect(
      invokeCreatePullRequestIpc(invoke, { ...request, base: "--help" }),
    ).rejects.toThrow();
    await expect(
      invokeCreatePullRequestIpc(invoke, { ...request, base: "a..b" }),
    ).rejects.toThrow();
    await expect(
      invokeGetPullRequestContextIpc(invoke, {
        repositoryRoot: "/repo",
        worktreePath: null,
        base: "--help",
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("rejects an oversized body and relative roots without invoking", async () => {
    const { calls, invoke } = recordingInvoke(null);

    await expect(
      invokeCreatePullRequestIpc(invoke, { ...request, body: "b".repeat(70 * 1024) }),
    ).rejects.toThrow("The description is too long.");
    await expect(
      invokeCreatePullRequestIpc(invoke, { ...request, repositoryRoot: "repo" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("sends the context request and parses the context", async () => {
    const { calls, invoke } = recordingInvoke(context);

    const parsed = await invokeGetPullRequestContextIpc(invoke, {
      repositoryRoot: "/repo",
      worktreePath: null,
      base: "develop",
    });

    expect(calls).toEqual([
      {
        command: "get_pull_request_context",
        args: { request: { repositoryRoot: "/repo", worktreePath: null, base: "develop" } },
      },
    ]);
    expect(parsed).toEqual(context);
  });

  it("rejects responses with extra keys", async () => {
    const extraContext = recordingInvoke({ ...context, token: "secret" });
    const extraReceipt = recordingInvoke({
      url: "https://github.com/acme/orders-api/pull/9",
      forge: "github",
      pid: 1,
    });

    await expect(
      invokeGetPullRequestContextIpc(extraContext.invoke, {
        repositoryRoot: "/repo",
        worktreePath: null,
        base: null,
      }),
    ).rejects.toThrow();
    await expect(invokeCreatePullRequestIpc(extraReceipt.invoke, request)).rejects.toThrow();
  });
});
