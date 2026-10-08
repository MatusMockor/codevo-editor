import { describe, expect, it } from "vitest";
import { admitStoredAgentLaunch, normalizeStoredAgentLaunch } from "./agentStoredLaunch";
import { normalizeAgentComposerLaunch } from "../components/agentMode/agentComposerLaunch";
import type { AgentLaunchOptions, ClaudeLaunchOptions } from "./agentLaunch";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeManifestModel,
  type ClaudeModelManifest,
} from "./claudeModelCatalog";

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

  it("never puts a context on a model whose catalog window is fixed", () => {
    const fixedWindow: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "claude-opus-4-7",
      mode: "bypassPermissions",
      effort: "high",
    };
    for (const stored of [fixedWindow, { ...fixedWindow, context: "1m" } as const]) {
      expect(normalizeStoredAgentLaunch(stored)).toEqual(fixedWindow);
      expect(admitStoredAgentLaunch({ ...stored, mode: "default" }, true).launch).toEqual(
        fixedWindow,
      );
      expect(normalizeAgentComposerLaunch(stored)).toEqual(fixedWindow);
    }
  });

  it("keeps the context of a model that offers a choice, a default model or an unknown one", () => {
    for (const model of ["claude-opus-4-6", "default", "claude-future-9"] as const) {
      const stored: ClaudeLaunchOptions = {
        provider: "claudeCode",
        model,
        mode: "bypassPermissions",
        effort: "high",
      };
      const explicit: ClaudeLaunchOptions = { ...stored, context: "200k" };
      expect(normalizeStoredAgentLaunch(stored)).toEqual({ ...stored, context: "1m" });
      expect(normalizeStoredAgentLaunch(explicit)).toEqual(explicit);
    }
  });

  it("lets the supplied catalog decide over the bundle whether a window is fixed", () => {
    const withWindows = (
      model: string,
      contextWindows: ClaudeManifestModel["contextWindows"],
    ): ClaudeModelManifest => ({
      ...BUNDLED_CLAUDE_MODEL_MANIFEST,
      claudeCode: BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.map((entry) =>
        entry.choice === model
          ? { ...entry, contextWindows, defaultContext: contextWindows[0] ?? null }
          : entry,
      ),
    });
    const offeredByBundle: ClaudeLaunchOptions = {
      provider: "claudeCode",
      model: "claude-opus-4-6",
      mode: "bypassPermissions",
      effort: "high",
    };
    const fixedNow = withWindows(offeredByBundle.model, []);
    expect(normalizeStoredAgentLaunch(offeredByBundle)).toEqual({
      ...offeredByBundle,
      context: "1m",
    });
    expect(normalizeStoredAgentLaunch(offeredByBundle, fixedNow)).toEqual(offeredByBundle);
    const storedWithContext: ClaudeLaunchOptions = { ...offeredByBundle, context: "1m" };
    expect(normalizeStoredAgentLaunch(storedWithContext, fixedNow)).toEqual(offeredByBundle);
    expect(admitStoredAgentLaunch({ ...offeredByBundle, mode: "default" }, true, fixedNow)).toEqual(
      { kind: "ready", launch: offeredByBundle, dangerousLaunchConfirmed: true },
    );

    const fixedByBundle: ClaudeLaunchOptions = { ...offeredByBundle, model: "claude-opus-4-7" };
    const offeredNow = withWindows(fixedByBundle.model, ["200k", "1m"]);
    expect(normalizeStoredAgentLaunch(fixedByBundle)).toEqual(fixedByBundle);
    const chosen: ClaudeLaunchOptions = { ...fixedByBundle, context: "200k" };
    expect(normalizeStoredAgentLaunch(chosen, offeredNow)).toEqual(chosen);
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
