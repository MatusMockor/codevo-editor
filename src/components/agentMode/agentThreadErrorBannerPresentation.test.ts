import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadErrorBannerModel } from "./agentThreadErrorBannerPresentation";

function view(
  status: unknown,
  provider: "claudeCode" | "codex" = "claudeCode",
  events: ReadonlyArray<unknown> = [],
  remote = false,
): AgentThreadView {
  return {
    ...(remote ? { execution: { kind: "remote" } } : {}),
    thread: {
      threadId: "agt-1",
      archived: false,
      provider: { kind: provider, sessionId: null },
      owner: { rootKey: "/r", ownerId: "w", repositoryRoot: "/r" },
      turns: [
        {
          turnId: "t1",
          prompt: "p",
          status,
          events,
          launch: { provider, model: "default", mode: "default" },
        },
      ],
    },
  } as unknown as AgentThreadView;
}

describe("thread error banner model", () => {
  it("uses the provider headline and hint for a protocol failure", () => {
    const model = agentThreadErrorBannerModel(
      view({ kind: "failed", message: "provider_protocol_failed" }),
      null,
    );
    expect(model?.title).toBe("Claude Code could not complete this run.");
    expect(model?.detail).toBe(
      "The provider session could not continue. Check the provider CLI and try again.",
    );
    expect(model?.key).toBe("agt-1\u0001t1");
    expect(model?.retry.kind).toBe("ready");
  });

  it("offers a retry before a sign-in when the provider rejected authentication", () => {
    expect(
      agentThreadErrorBannerModel(view({ kind: "failed", message: "authentication_failed" }), null),
    ).toMatchObject({
      title: "Claude Code could not authenticate this run.",
      detail: "Try again. If it keeps failing, run claude in a terminal and sign in with /login.",
    });
  });

  it("classifies the reported error of a run that exited after an expired sign-in", () => {
    const events = [
      {
        kind: "assistantText",
        text: "Failed to authenticate: OAuth session expired and could not be refreshed",
      },
      {
        kind: "result",
        text: "Failed to authenticate: OAuth session expired and could not be refreshed",
        isError: true,
        usage: null,
      },
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1 },
    ];
    expect(
      agentThreadErrorBannerModel(
        view({ kind: "exited", exitCode: 1 }, "claudeCode", events),
        null,
      ),
    ).toMatchObject({
      title: "Claude Code needs you to sign in again.",
      detail: "Run claude in a terminal and sign in with /login, then try again.",
    });
  });

  it("reports a usage limit with its reset and never asks to sign in", () => {
    const events = [
      {
        kind: "result",
        text: "You've hit your weekly limit · resets Sep 29 at 8am (Europe/Bratislava)",
        isError: true,
        usage: null,
      },
    ];
    const model = agentThreadErrorBannerModel(
      view({ kind: "exited", exitCode: 1 }, "claudeCode", events),
      null,
    );
    expect(model).toMatchObject({
      title: "Claude Code usage limit reached. Resets Sep 29 at 8am (Europe/Bratislava).",
      detail: "Wait for the limit to reset, or switch to another model or provider.",
    });
    expect(model?.detail).not.toMatch(/sign in/iu);
  });

  it("directs a remote sign-in to the server running the thread", () => {
    expect(
      agentThreadErrorBannerModel(
        view(
          {
            kind: "failed",
            message: "Failed to authenticate: OAuth session expired and could not be refreshed",
          },
          "claudeCode",
          [],
          true,
        ),
        null,
      )?.detail,
    ).toBe("Sign in to Claude Code on the server running this thread, then try again.");
  });

  it("asks to retry shortly when the provider is over capacity", () => {
    const events = [
      {
        kind: "result",
        text: "Selected model is at capacity. Please try a different model.",
        isError: true,
        usage: null,
      },
    ];
    expect(
      agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }, "codex", events), null),
    ).toMatchObject({
      title: "Codex is temporarily over capacity.",
      detail: "Try again in a moment, or switch to another model.",
    });
  });

  it("asks only to retry when the whole Claude service is overloaded", () => {
    const events = [
      {
        kind: "result",
        text: "API Error: Repeated 529 Overloaded errors",
        isError: true,
        usage: null,
      },
    ];
    expect(
      agentThreadErrorBannerModel(
        view({ kind: "exited", exitCode: 1 }, "claudeCode", events),
        null,
      ),
    ).toMatchObject({
      title: "Claude Code is temporarily over capacity.",
      detail: "Try again in a moment.",
    });
  });

  it("does not blame an earlier error once the run kept working after it", () => {
    const events = [
      { kind: "error", message: "Selected model is at capacity. Please try a different model." },
      { kind: "toolCall", toolId: "t1", name: "Bash", inputSummary: "ls" },
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1 },
    ];
    expect(
      agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }, "codex", events), null),
    ).toMatchObject({
      title: "Codex could not complete this run.",
      detail: "The agent process exited with code 1.",
    });
    const afterText = [
      { kind: "error", message: "Selected model is at capacity. Please try a different model." },
      { kind: "assistantText", text: "Continuing." },
    ];
    expect(
      agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }, "codex", afterText), null)
        ?.detail,
    ).toBe("The agent process exited with code 1.");
  });

  it("keeps the exit code when the last reported error is not classified", () => {
    const events = [{ kind: "result", text: "Something odd", isError: true, usage: null }];
    expect(
      agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }, "codex", events), null),
    ).toMatchObject({
      title: "Codex could not complete this run.",
      detail: "The agent process exited with code 1.",
    });
  });

  it("explains a non-zero exit and bounds an unknown message to its first line", () => {
    expect(
      agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }, "codex"), null),
    ).toMatchObject({
      title: "Codex could not complete this run.",
      detail: "The agent process exited with code 1.",
    });
    const long = `${"x".repeat(400)}\nsecond line`;
    const detail =
      agentThreadErrorBannerModel(view({ kind: "failed", message: long }), null)?.detail ?? "";
    expect(detail.length).toBeLessThanOrEqual(241);
    expect(detail).not.toContain("second line");
  });

  it("returns null when nothing failed", () => {
    expect(agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 0 }), null)).toBeNull();
    expect(agentThreadErrorBannerModel(view({ kind: "running" }), null)).toBeNull();
    expect(agentThreadErrorBannerModel(null, null)).toBeNull();
  });
});
