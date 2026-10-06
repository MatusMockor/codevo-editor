import { describe, expect, it } from "vitest";
import { composerPendingSendTarget } from "./useAgentPendingSends";

const NEW = { kind: "new", projectRootKey: "/app" } as const;
const FOLLOW_UP = { kind: "followUp", threadId: "agt-1", steer: false } as const;
const IDLE = { queuedEditThreadId: null, baseTurnId: "t1", provider: "claudeCode" } as const;

describe("composerPendingSendTarget", () => {
  it("targets a new thread with the provider it launches", () => {
    expect(composerPendingSendTarget(NEW, { ...IDLE, provider: "codex" })).toEqual({
      kind: "new",
      projectRootKey: "/app",
      provider: "codex",
    });
  });

  it("falls back to the default provider for an unknown launch provider", () => {
    expect(composerPendingSendTarget(NEW, { ...IDLE, provider: "other" })).toEqual({
      kind: "new",
      projectRootKey: "/app",
      provider: "claudeCode",
    });
  });

  it("targets a follow-up after the turn it was sent from", () => {
    expect(composerPendingSendTarget(FOLLOW_UP, IDLE)).toEqual({
      kind: "followUp",
      threadId: "agt-1",
      baseTurnId: "t1",
    });
  });

  it("shows no optimistic message for a steer", () => {
    expect(composerPendingSendTarget({ ...FOLLOW_UP, steer: true }, IDLE)).toBeNull();
  });

  it("shows no optimistic message while the thread's queued message is edited", () => {
    expect(
      composerPendingSendTarget(FOLLOW_UP, { ...IDLE, queuedEditThreadId: "agt-1" }),
    ).toBeNull();
    expect(
      composerPendingSendTarget(FOLLOW_UP, { ...IDLE, queuedEditThreadId: "agt-2" }),
    ).not.toBeNull();
  });
});
