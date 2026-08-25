import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
} from "../../domain/agentLaunch";
import {
  agentLaunchDangerConfirmLabel,
  agentLaunchDangerNotice,
  agentLaunchMetaLabel,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchModelChoices,
  agentLaunchModelLabel,
  agentLaunchTone,
} from "./agentLaunchPresentation";

describe("agentLaunchPresentation", () => {
  it("offers exactly the closed domain choices per provider", () => {
    expect(agentLaunchModelChoices("claudeCode").map((choice) => choice.value)).toEqual([
      ...CLAUDE_MODEL_CHOICES,
    ]);
    expect(agentLaunchModeChoices("claudeCode").map((choice) => choice.value)).toEqual([
      ...CLAUDE_PERMISSION_MODES,
    ]);
    expect(agentLaunchModelChoices("codex").map((choice) => choice.value)).toEqual([
      ...CODEX_MODEL_CHOICES,
    ]);
    expect(agentLaunchModeChoices("codex").map((choice) => choice.value)).toEqual([
      ...CODEX_EXECUTION_MODES,
    ]);
  });

  it("gives every choice a label and a one-line hint", () => {
    const choices = [
      ...agentLaunchModelChoices("claudeCode"),
      ...agentLaunchModeChoices("claudeCode"),
      ...agentLaunchModelChoices("codex"),
      ...agentLaunchModeChoices("codex"),
    ];

    for (const choice of choices) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.hint.length).toBeGreaterThan(0);
      expect(choice.hint).not.toContain("\n");
    }
  });

  it("names the provider default without inventing a model name", () => {
    expect(
      agentLaunchModelLabel({ provider: "claudeCode", model: "default", mode: "default" }),
    ).toBe("Default model");
    expect(
      agentLaunchModeLabel({ provider: "claudeCode", model: "default", mode: "default" }),
    ).toBe("Default permissions");
    expect(agentLaunchModeLabel({ provider: "codex", model: "default", mode: "default" })).toBe(
      "Default sandbox",
    );
    expect(agentLaunchModeHint({ provider: "codex", model: "default", mode: "default" })).toContain(
      "configured",
    );
  });

  it("renders a compact meta label for a turn record", () => {
    expect(
      agentLaunchMetaLabel({ provider: "claudeCode", model: "opus", mode: "acceptEdits" }),
    ).toBe("opus · accept edits");
    expect(
      agentLaunchMetaLabel({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe("gpt-5.5 · workspace write");
  });

  it("tones plan and dangerous modes apart from the ordinary ones", () => {
    expect(agentLaunchTone({ provider: "claudeCode", model: "opus", mode: "plan" })).toBe("plan");
    expect(
      agentLaunchTone({ provider: "claudeCode", model: "opus", mode: "bypassPermissions" }),
    ).toBe("danger");
    expect(agentLaunchTone({ provider: "codex", model: "default", mode: "dangerFullAccess" })).toBe(
      "danger",
    );
    expect(agentLaunchTone({ provider: "codex", model: "default", mode: "readOnly" })).toBeNull();
  });

  it("warns truthfully about each dangerous mode and stays silent otherwise", () => {
    expect(
      agentLaunchDangerNotice({ provider: "claudeCode", model: "opus", mode: "bypassPermissions" }),
    ).toContain("Bypasses permission checks");
    expect(
      agentLaunchDangerNotice({ provider: "codex", model: "default", mode: "dangerFullAccess" }),
    ).toContain("sandbox");
    expect(
      agentLaunchDangerNotice({ provider: "claudeCode", model: "opus", mode: "acceptEdits" }),
    ).toBeNull();
  });

  it("labels the confirmation per provider", () => {
    expect(
      agentLaunchDangerConfirmLabel({
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
      }),
    ).toContain("permission checks");
    expect(
      agentLaunchDangerConfirmLabel({
        provider: "codex",
        model: "default",
        mode: "dangerFullAccess",
      }),
    ).toContain("sandbox");
  });
});
