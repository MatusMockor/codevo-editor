import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import { agentThreadErrorBannerModel } from "./agentThreadErrorBannerPresentation";

const CHECK_RUNNER = "Try again. If it keeps failing, check the runner on that server.";
const GENERIC_STATUS = { kind: "failed", message: "provider_reported_failure" };
const CHECK_RUN_OUTPUT =
  "Check this run's output for any details, then try again. If it keeps failing, check the provider CLI on that server.";

function runnerHeadline(code: string, provider: "claudeCode" | "codex" = "claudeCode"): string {
  return agentProviderErrorHeadline(classifyAgentProviderError(code, provider), null);
}

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

  it("asks for a new thread when the conversation holds images the API rejects", () => {
    const notice =
      "API Error: an image in the conversation could not be processed and was removed. Re-read the file with a different approach if you still need it.";
    const model = agentThreadErrorBannerModel(
      view({ kind: "exited", exitCode: 1 }, "claudeCode", [
        { kind: "assistantText", text: notice },
      ]),
      null,
    );
    expect(model).toMatchObject({
      title: "This conversation contains images larger than the API allows.",
      detail: "Start a new thread to continue.",
      remedy: "startNewThread",
    });
  });

  it("asks for a new thread on the wrapped many-image dimension error, local or remote", () => {
    const message = `API Error: 400 ${JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "messages.154.content.1.image.source.base64.data: At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels",
      },
      request_id: "req_1",
    })}`;
    for (const remote of [false, true]) {
      expect(
        agentThreadErrorBannerModel(
          view({ kind: "failed", message }, "claudeCode", [], remote),
          null,
        ),
      ).toMatchObject({
        title: "This conversation contains images larger than the API allows.",
        detail: "Start a new thread to continue.",
        remedy: "startNewThread",
      });
    }
  });

  it("keeps Retry as the remedy for every other failure", () => {
    expect(
      agentThreadErrorBannerModel(view({ kind: "failed", message: "authentication_failed" }), null)
        ?.remedy,
    ).toBe("retry");
    expect(agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }), null)?.remedy).toBe(
      "retry",
    );
  });

  it.each([
    {
      code: "process_cleanup_failed",
      detail:
        "Processes from this run may still be running on that server. Check them before you try again. If it keeps happening, restart the runner on that server.",
    },
    {
      code: "execution_timeout",
      detail:
        "Files this run already changed are left as they are. Try again to continue, or raise the runner's time limit on that server.",
    },
    {
      code: "provider_unavailable",
      detail: "Check the provider CLI and the runner on that server, then try again.",
    },
    {
      code: "provider_result_missing",
      detail: "Try again. If it keeps failing, check the provider CLI on that server.",
    },
    { code: "provider_reported_failure", detail: CHECK_RUN_OUTPUT },
    {
      code: "provider_input_failed",
      detail:
        "The server could not continue the provider session. Check the runner on that server and try again.",
    },
    {
      code: "output_persistence_failed",
      detail:
        "Try again. If it keeps failing, check free disk space for the runner on that server.",
    },
    { code: "output_limit_exceeded", detail: CHECK_RUNNER },
    { code: "instruction_sync_failed", detail: CHECK_RUNNER },
    { code: "execution_failed", detail: CHECK_RUNNER },
  ])("explains the runner code $code instead of showing it", ({ code, detail }) => {
    const model = agentThreadErrorBannerModel(
      view(
        { kind: "failed", message: code },
        "claudeCode",
        [{ kind: "error", message: code }],
        true,
      ),
      null,
    );

    expect(model).toMatchObject({ title: runnerHeadline(code), detail, remedy: "retry" });
    expect(model?.retry.kind).toBe("ready");
    expect(`${model?.title} ${model?.detail}`).not.toContain(code);
    expect(`${model?.title} ${model?.detail}`).not.toMatch(/[\u2013\u2014]/u);
  });

  it("explains a provider-reported failure recorded only as the turn status", () => {
    const model = agentThreadErrorBannerModel(
      view({ kind: "failed", message: "provider_reported_failure" }, "codex", [], true),
      null,
    );

    expect(model).toMatchObject({
      title: "Codex did not complete this run successfully.",
      detail: CHECK_RUN_OUTPUT,
      remedy: "retry",
    });
    expect(`${model?.title} ${model?.detail}`).not.toContain("provider_reported_failure");
  });

  it("does not point a local run at a server", () => {
    expect(agentThreadErrorBannerModel(view(GENERIC_STATUS, "codex"), null)).toMatchObject({
      title: "Codex did not complete this run successfully.",
      detail:
        "Check this run's output for any details, then try again. If it keeps failing, check the provider CLI.",
      remedy: "retry",
    });
  });

  it("explains a runner code reported only by the events of an exited run", () => {
    expect(
      agentThreadErrorBannerModel(
        view(
          { kind: "exited", exitCode: 1 },
          "codex",
          [{ kind: "error", message: "process_cleanup_failed" }],
          true,
        ),
        null,
      ),
    ).toMatchObject({
      title: runnerHeadline("process_cleanup_failed", "codex"),
      remedy: "retry",
    });
  });

  it.each([
    "The tool printed process_cleanup_failed while cleaning up.",
    "process_cleanup_failed: could not signal pid 4242",
    "PROCESS_CLEANUP_FAILED",
  ])("does not reclassify provider text that only contains a runner code (%j)", (message) => {
    expect(
      agentThreadErrorBannerModel(view({ kind: "failed", message }, "claudeCode", [], true), null),
    ).toMatchObject({
      title: "Claude Code could not complete this run.",
      detail: message,
      remedy: "retry",
    });
  });

  it.each(["workspace_identity_invalid", "git_branch_not_found", "brand_new_runner_code"])(
    "keeps the unmapped runner code %s as the detail",
    (code) => {
      expect(
        agentThreadErrorBannerModel(
          view({ kind: "failed", message: code }, "claudeCode", [], true),
          null,
        ),
      ).toMatchObject({
        title: "Claude Code could not complete this run.",
        detail: code,
        remedy: "retry",
      });
    },
  );

  it("returns null when nothing failed", () => {
    expect(agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 0 }), null)).toBeNull();
    expect(agentThreadErrorBannerModel(view({ kind: "running" }), null)).toBeNull();
    expect(agentThreadErrorBannerModel(null, null)).toBeNull();
  });
});
