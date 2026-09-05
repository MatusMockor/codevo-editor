import { describe, expect, it } from "vitest";

import {
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
  DEFAULT_AGENT_LAUNCH_OPTIONS,
  agentLaunchIsDangerous,
  agentLaunchMatchesProvider,
  agentLaunchOptionsEqual,
  defaultAgentLaunchOptions,
  parseAgentLaunchOptions,
  parseStoredAgentLaunchOptions,
  serializeAgentLaunchOptions,
  CLAUDE_EFFORT_CHOICES,
  type AgentLaunchOptions,
  type ClaudeLaunchOptions,
} from "./agentLaunch";

describe("agentLaunch", () => {
  it("keeps wire defaults flagless while the composer owns the product default", () => {
    expect(defaultAgentLaunchOptions("claudeCode")).toEqual({
      provider: "claudeCode",
      model: "default",
      mode: "default",
      effort: "default",
      context: "1m",
      fastMode: false,
      thinkingMode: false,
    });
    expect(defaultAgentLaunchOptions("codex")).toEqual({
      provider: "codex",
      model: "default",
      mode: "default",
    });
    expect(DEFAULT_AGENT_LAUNCH_OPTIONS.claudeCode).toEqual(
      defaultAgentLaunchOptions("claudeCode"),
    );
    expect(DEFAULT_AGENT_LAUNCH_OPTIONS.codex).toEqual(defaultAgentLaunchOptions("codex"));
  });

  it("accepts every claude model and permission mode pair", () => {
    for (const model of CLAUDE_MODEL_CHOICES) {
      for (const mode of CLAUDE_PERMISSION_MODES) {
        const value = { provider: "claudeCode", model, mode, effort: "default" };
        expect(parseAgentLaunchOptions(value, "launch")).toEqual(value);
      }
    }
  });

  it("accepts every codex model and execution mode pair", () => {
    for (const model of CODEX_MODEL_CHOICES) {
      for (const mode of CODEX_EXECUTION_MODES) {
        const value = { provider: "codex", model, mode };
        expect(parseAgentLaunchOptions(value, "launch")).toEqual(value);
      }
    }
  });

  it("preserves GPT-6 Astra through launch and saved-thread serialization", () => {
    const value = { provider: "codex", model: "gpt-6-astra", mode: "workspaceWrite" };
    const launch = parseAgentLaunchOptions(value, "launch");
    expect(serializeAgentLaunchOptions(launch)).toEqual(value);
    expect(parseStoredAgentLaunchOptions(JSON.parse(JSON.stringify(launch)), "launch")).toEqual(
      value,
    );
  });

  it("rejects every model and mode taken from the other provider", () => {
    for (const model of CODEX_MODEL_CHOICES.filter((choice) => choice !== "default")) {
      expect(() =>
        parseAgentLaunchOptions(
          { provider: "claudeCode", model, mode: "default", effort: "default" },
          "launch",
        ),
      ).toThrow(/launch\.model/);
    }
    for (const mode of CODEX_EXECUTION_MODES.filter(
      (choice) => choice !== "default" && choice !== "auto",
    )) {
      expect(() =>
        parseAgentLaunchOptions(
          { provider: "claudeCode", model: "default", mode, effort: "default" },
          "launch",
        ),
      ).toThrow(/launch\.mode/);
    }
    for (const model of CLAUDE_MODEL_CHOICES.filter((choice) => choice !== "default")) {
      expect(() =>
        parseAgentLaunchOptions({ provider: "codex", model, mode: "default" }, "launch"),
      ).toThrow(/launch\.model/);
    }
    for (const mode of CLAUDE_PERMISSION_MODES.filter(
      (choice) => choice !== "default" && choice !== "auto",
    )) {
      expect(() =>
        parseAgentLaunchOptions({ provider: "codex", model: "default", mode }, "launch"),
      ).toThrow(/launch\.mode/);
    }
  });

  it("round trips every accepted pair through JSON", () => {
    const pairs: ReadonlyArray<AgentLaunchOptions> = [
      ...CLAUDE_MODEL_CHOICES.flatMap((model) =>
        CLAUDE_PERMISSION_MODES.map((mode): AgentLaunchOptions => ({
          provider: "claudeCode",
          model,
          mode,
          effort: "default",
        })),
      ),
      ...CODEX_MODEL_CHOICES.flatMap((model) =>
        CODEX_EXECUTION_MODES.map((mode): AgentLaunchOptions => ({
          provider: "codex",
          model,
          mode,
        })),
      ),
    ];

    for (const options of pairs) {
      const wire: unknown = JSON.parse(JSON.stringify(serializeAgentLaunchOptions(options)));
      expect(parseAgentLaunchOptions(wire, "launch")).toEqual(options);
    }
    expect(pairs).toHaveLength(119);
  });

  it("rejects non-string and casing variants of a known choice", () => {
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "claudeCode", model: "Opus", mode: "default", effort: "default" },
        "launch",
      ),
    ).toThrow(/launch\.model/);
    expect(() =>
      parseAgentLaunchOptions({ provider: "codex", model: "default", mode: 0 }, "launch"),
    ).toThrow(/launch\.mode/);
    expect(() =>
      parseAgentLaunchOptions({ provider: null, model: "default", mode: "default" }, "launch"),
    ).toThrow(/launch\.provider/);
  });

  it("round trips through serialization", () => {
    const options: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-5.5",
      mode: "workspaceWrite",
    };
    expect(parseAgentLaunchOptions(serializeAgentLaunchOptions(options), "launch")).toEqual(
      options,
    );
  });

  it("round trips executable Claude capability selections", () => {
    const options: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "ultracode",
      context: "1m",
      fastMode: true,
    };
    expect(parseAgentLaunchOptions(serializeAgentLaunchOptions(options), "launch")).toEqual(
      options,
    );
    expect(() =>
      parseAgentLaunchOptions(
        { ...serializeAgentLaunchOptions(options), fastMode: "yes" },
        "launch",
      ),
    ).toThrow(/launch\.fastMode/);
  });

  it("rejects unknown providers, models, and modes", () => {
    expect(() =>
      parseAgentLaunchOptions({ provider: "gemini", model: "default", mode: "default" }, "launch"),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "claudeCode", model: "claude-opus-4", mode: "default", effort: "default" },
        "launch",
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentLaunchOptions({ provider: "codex", model: "default", mode: "gpt-5" }, "launch"),
    ).toThrow(TypeError);
  });

  it("rejects cross-provider model and mode pairs", () => {
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "claudeCode", model: "gpt-5.5", mode: "default", effort: "default" },
        "launch",
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "codex", model: "default", mode: "acceptEdits" },
        "launch",
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "claudeCode", model: "default", mode: "readOnly", effort: "default" },
        "launch",
      ),
    ).toThrow(TypeError);
  });

  it("rejects extra, missing, and non-object payloads", () => {
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "codex", model: "default", mode: "default", effort: "high" },
        "launch",
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentLaunchOptions({ provider: "codex", model: "default" }, "launch"),
    ).toThrow(TypeError);
    expect(() => parseAgentLaunchOptions(null, "launch")).toThrow(TypeError);
    expect(() => parseAgentLaunchOptions([], "launch")).toThrow(TypeError);
    expect(() => parseAgentLaunchOptions("codex", "launch")).toThrow(TypeError);
  });

  it("matches launch options against the configured provider", () => {
    expect(agentLaunchMatchesProvider(defaultAgentLaunchOptions("codex"), "codex")).toBe(true);
    expect(agentLaunchMatchesProvider(defaultAgentLaunchOptions("codex"), "claudeCode")).toBe(
      false,
    );
  });

  it("classifies only the permission bypassing modes as dangerous", () => {
    expect(
      agentLaunchIsDangerous({
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
        effort: "default",
      }),
    ).toBe(true);
    expect(
      agentLaunchIsDangerous({ provider: "codex", model: "gpt-5.5", mode: "dangerFullAccess" }),
    ).toBe(true);
    expect(
      agentLaunchIsDangerous({
        provider: "claudeCode",
        model: "opus",
        mode: "acceptEdits",
        effort: "default",
      }),
    ).toBe(false);
    expect(
      agentLaunchIsDangerous({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe(false);
    expect(agentLaunchIsDangerous(defaultAgentLaunchOptions("claudeCode"))).toBe(false);
    expect(agentLaunchIsDangerous(defaultAgentLaunchOptions("codex"))).toBe(false);
  });

  it("compares launch options field by field", () => {
    const options: ClaudeLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "plan",
      effort: "default",
    };
    expect(agentLaunchOptionsEqual(options, { ...options })).toBe(true);
    expect(agentLaunchOptionsEqual(options, { ...options, model: "sonnet" })).toBe(false);
    expect(agentLaunchOptionsEqual(options, { ...options, mode: "default" })).toBe(false);
    expect(agentLaunchOptionsEqual(options, defaultAgentLaunchOptions("codex"))).toBe(false);
    expect(agentLaunchOptionsEqual(options, { ...options, effort: "xhigh" })).toBe(false);
  });

  it("accepts every claude effort choice and keeps it out of the codex shape", () => {
    for (const effort of CLAUDE_EFFORT_CHOICES) {
      const value = { provider: "claudeCode", model: "opus", mode: "plan", effort };
      expect(parseAgentLaunchOptions(value, "launch")).toEqual(value);
      expect(serializeAgentLaunchOptions(parseAgentLaunchOptions(value, "launch"))).toEqual(value);
    }

    expect(serializeAgentLaunchOptions(defaultAgentLaunchOptions("codex"))).toEqual({
      provider: "codex",
      model: "default",
      mode: "default",
    });
    expect(() =>
      parseAgentLaunchOptions(
        { provider: "claudeCode", model: "opus", mode: "plan", effort: "ultra" },
        "launch",
      ),
    ).toThrow(/launch\.effort/);
  });

  it("accepts stored claude launches without an effort field and fills the default", () => {
    expect(
      parseStoredAgentLaunchOptions(
        { provider: "claudeCode", model: "sonnet", mode: "plan" },
        "launch",
      ),
    ).toEqual({ provider: "claudeCode", model: "sonnet", mode: "plan", effort: "default" });

    expect(() =>
      parseAgentLaunchOptions({ provider: "claudeCode", model: "sonnet", mode: "plan" }, "launch"),
    ).toThrow(TypeError);

    expect(() =>
      parseStoredAgentLaunchOptions(
        { provider: "codex", model: "default", mode: "default", effort: "high" },
        "launch",
      ),
    ).toThrow(TypeError);
  });
});
