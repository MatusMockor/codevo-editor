import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadErrorBannerModel } from "./agentThreadErrorBannerPresentation";

function view(status: unknown, provider: "claudeCode" | "codex" = "claudeCode"): AgentThreadView {
  return {
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

  it("asks the user to sign in again when authentication failed", () => {
    expect(
      agentThreadErrorBannerModel(view({ kind: "failed", message: "authentication_failed" }), null),
    ).toMatchObject({
      title: "Claude Code needs you to sign in again.",
      detail: "Sign in to Claude Code again, then retry.",
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
