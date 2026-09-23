import { describe, expect, it } from "vitest";
import { admitStoredAgentLaunch, normalizeStoredAgentLaunch } from "./agentStoredLaunch";
import { normalizeAgentComposerLaunch } from "../components/agentMode/agentComposerLaunch";
import type { AgentLaunchOptions } from "./agentLaunch";

describe("normalizeStoredAgentLaunch", () => {
  it("replaces the retired CLI-inherited modes exactly like the composer", () => {
    const codex: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };
    const claude: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "default",
      effort: "default",
    };
    expect(normalizeStoredAgentLaunch(codex)).toEqual({ ...codex, mode: "dangerFullAccess" });
    expect(normalizeStoredAgentLaunch(claude)).toEqual({
      ...claude,
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    });
    for (const launch of [codex, claude])
      expect(normalizeAgentComposerLaunch(launch)).toEqual(normalizeStoredAgentLaunch(launch));
  });

  it("keeps an explicitly chosen mode", () => {
    const codex: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-5.5",
      mode: "workspaceWrite",
    };
    expect(normalizeStoredAgentLaunch(codex)).toEqual(codex);
  });

  it("requires the caller's confirmation only when a retired mode is promoted to full access", () => {
    const retired: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };
    const full: AgentLaunchOptions = { ...retired, mode: "dangerFullAccess" };
    const guarded: AgentLaunchOptions = { ...retired, mode: "workspaceWrite" };
    expect(admitStoredAgentLaunch(retired, false)).toEqual({
      kind: "needsConfirmation",
      launch: full,
    });
    expect(admitStoredAgentLaunch(retired, true)).toEqual({
      kind: "ready",
      launch: full,
      dangerousLaunchConfirmed: true,
    });
    expect(admitStoredAgentLaunch(full, false)).toEqual({
      kind: "ready",
      launch: full,
      dangerousLaunchConfirmed: true,
    });
    expect(admitStoredAgentLaunch(guarded, false)).toEqual({
      kind: "ready",
      launch: guarded,
      dangerousLaunchConfirmed: false,
    });
  });
});
