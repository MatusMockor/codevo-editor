import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { admitStoredAgentLaunch } from "../../domain/agentStoredLaunch";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeManifestModel,
} from "../../domain/claudeModelCatalog";
import { defaultAgentComposerLaunch, normalizeAgentComposerLaunch } from "./agentComposerLaunch";
import {
  agentLaunchForDispatch,
  agentLaunchWithChrome,
  agentLaunchWithMode,
  agentLaunchWithModel,
  agentLaunchWithThinkingMode,
} from "./agentLaunchPresentation";

const catalog = BUNDLED_CLAUDE_MODEL_MANIFEST;

function entryFor(model: string): ClaudeManifestModel {
  const entry = catalog.claudeCode.find((candidate) => candidate.choice === model);
  expect(entry).toBeDefined();
  return entry as ClaudeManifestModel;
}

function unsupportedCapabilities(launch: AgentLaunchOptions): ReadonlyArray<string> {
  expect(launch.provider).toBe("claudeCode");
  if (launch.provider !== "claudeCode") return ["provider"];
  const entry = entryFor(launch.model);
  const context = launch.context ?? "200k";
  return [
    ...(launch.effort !== "default" && !entry.efforts.includes(launch.effort)
      ? [`effort:${launch.effort}`]
      : []),
    ...(entry.contextWindows.length > 0 && !entry.contextWindows.includes(context)
      ? [`context:${context}`]
      : []),
    ...(launch.fastMode === true && !entry.fastMode ? ["fastMode"] : []),
    ...(launch.thinkingMode === true && !entry.thinkingMode ? ["thinkingMode"] : []),
  ];
}

function composerLaunchFor(
  from: AgentLaunchOptions,
  model: string,
  edit: (launch: AgentLaunchOptions) => AgentLaunchOptions = (launch) => launch,
): AgentLaunchOptions {
  const picked = agentLaunchWithModel(normalizeAgentComposerLaunch(from), model, null, catalog);
  return normalizeAgentComposerLaunch(edit(normalizeAgentComposerLaunch(picked)));
}

function admittedSubmission(composerLaunch: AgentLaunchOptions): AgentLaunchOptions {
  const dispatched = agentLaunchForDispatch(composerLaunch, null, catalog);
  const admission = admitStoredAgentLaunch(dispatched, true);
  expect(admission.kind).toBe("ready");
  return admission.launch;
}

describe("launch options stay within the selected model's capabilities", () => {
  it("sends Claude Haiku 4.5 with thinking off, Chrome off and Auto access", () => {
    const composer = composerLaunchFor(
      defaultAgentComposerLaunch("claudeCode"),
      "claude-haiku-4-5",
      (launch) =>
        agentLaunchWithMode(
          agentLaunchWithChrome(
            agentLaunchWithThinkingMode(launch, false, null, catalog),
            false,
            null,
            catalog,
          ),
          "auto",
        ),
    );

    const admitted = admittedSubmission(composer);

    expect(admitted).toMatchObject({
      model: "claude-haiku-4-5",
      mode: "auto",
      effort: "default",
      thinkingMode: false,
      chrome: false,
    });
    expect(unsupportedCapabilities(admitted)).toEqual([]);
  });

  it("sends Claude Haiku 4.5 with thinking on", () => {
    const composer = composerLaunchFor(
      defaultAgentComposerLaunch("claudeCode"),
      "claude-haiku-4-5",
      (launch) => agentLaunchWithThinkingMode(launch, true, null, catalog),
    );

    const admitted = admittedSubmission(composer);

    expect(admitted).toMatchObject({ effort: "default", thinkingMode: true });
    expect(unsupportedCapabilities(admitted)).toEqual([]);
  });

  it("admits every catalog model picked from a high-effort 1M launch", () => {
    const start: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "claude-opus-5",
      mode: "bypassPermissions",
      effort: "max",
      context: "1m",
      fastMode: true,
      thinkingMode: false,
    };
    for (const entry of catalog.claudeCode) {
      const admitted = admittedSubmission(composerLaunchFor(start, entry.choice));
      expect({ model: entry.choice, unsupported: unsupportedCapabilities(admitted) }).toEqual({
        model: entry.choice,
        unsupported: [],
      });
    }
  });

  it("restores effort and 1M context when switching from Haiku back to a capable model", () => {
    const haiku = composerLaunchFor(defaultAgentComposerLaunch("claudeCode"), "claude-haiku-4-5");
    expect(admittedSubmission(haiku)).toMatchObject({ effort: "default" });

    const opus = admittedSubmission(composerLaunchFor(haiku, "claude-opus-5"));

    expect(opus).toMatchObject({
      model: "claude-opus-5",
      effort: entryFor("claude-opus-5").defaultEffort,
      context: "1m",
    });
    expect(opus.provider === "claudeCode" && opus.effort).not.toBe("default");
    expect(unsupportedCapabilities(opus)).toEqual([]);
  });

  it("repairs a Haiku launch stored with an effort the model does not offer", () => {
    const stored: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "claude-haiku-4-5",
      mode: "auto",
      effort: "high",
      context: "1m",
      thinkingMode: false,
    };

    const admission = admitStoredAgentLaunch(stored, false);

    expect(admission.kind).toBe("ready");
    expect(admission.launch).toMatchObject({ effort: "default" });
    expect(unsupportedCapabilities(admission.launch)).toEqual([]);
  });

  it("keeps the legacy high/1M default for stored launches of capable models", () => {
    const stored: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "claude-opus-5",
      mode: "auto",
      effort: "default",
    };

    expect(admitStoredAgentLaunch(stored, false).launch).toMatchObject({
      effort: "high",
      context: "1m",
    });
  });

  it("does not invent an effort for a model only the live catalog knows", () => {
    const stored: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "claude-live-only-9",
      mode: "auto",
      effort: "default",
    };

    expect(admitStoredAgentLaunch(stored, false).launch).toMatchObject({ effort: "default" });
  });
});
