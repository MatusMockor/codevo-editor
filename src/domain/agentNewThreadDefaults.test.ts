import { describe, expect, it } from "vitest";
import { CLAUDE_EFFORT_CHOICES, CODEX_EFFORT_CHOICES } from "./agentLaunch";
import {
  DEFAULT_AGENT_NEW_THREAD_LAUNCH_SOURCE,
  defaultAgentNewThreadDefaults,
  normalizeAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "./agentNewThreadDefaults";

const DEFAULTS = {
  source: "defaults",
  claudeCode: { model: "default", effort: "high" },
  codex: { model: "default", effort: "default" },
} as const;

const CUSTOM: AgentNewThreadDefaults = {
  source: "lastUsed",
  claudeCode: { model: "claude-opus-4-8", effort: "xhigh" },
  codex: { model: "gpt-5.5", effort: "medium" },
};

describe("defaultAgentNewThreadDefaults", () => {
  it("mirrors the built-in composer launch for both providers", () => {
    expect(defaultAgentNewThreadDefaults()).toEqual(DEFAULTS);
    expect(DEFAULT_AGENT_NEW_THREAD_LAUNCH_SOURCE).toBe("defaults");
  });

  it("returns fresh records on every call", () => {
    const first = defaultAgentNewThreadDefaults();
    const second = defaultAgentNewThreadDefaults();

    expect(first).not.toBe(second);
    expect(first.claudeCode).not.toBe(second.claudeCode);
    expect(first.codex).not.toBe(second.codex);
  });
});

describe("normalizeAgentNewThreadDefaults", () => {
  it("round-trips a valid value into a fresh record", () => {
    const normalized = normalizeAgentNewThreadDefaults(CUSTOM);

    expect(normalized).toEqual(CUSTOM);
    expect(normalized).not.toBe(CUSTOM);
    expect(normalized.claudeCode).not.toBe(CUSTOM.claudeCode);
    expect(normalized.codex).not.toBe(CUSTOM.codex);
    expect(normalizeAgentNewThreadDefaults(JSON.parse(JSON.stringify(normalized)))).toEqual(CUSTOM);
    expect(normalizeAgentNewThreadDefaults(defaultAgentNewThreadDefaults())).toEqual(DEFAULTS);
  });

  it("accepts every source and every effort choice of each provider", () => {
    for (const source of ["defaults", "lastUsed"] as const) {
      expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, source }).source).toBe(source);
    }
    for (const effort of CLAUDE_EFFORT_CHOICES) {
      expect(
        normalizeAgentNewThreadDefaults({ ...CUSTOM, claudeCode: { model: "opus", effort } })
          .claudeCode,
      ).toEqual({ model: "opus", effort });
    }
    for (const effort of CODEX_EFFORT_CHOICES) {
      expect(
        normalizeAgentNewThreadDefaults({ ...CUSTOM, codex: { model: "gpt-5.5", effort } }).codex,
      ).toEqual({ model: "gpt-5.5", effort });
    }
  });

  it("accepts a record without a prototype", () => {
    const value = Object.assign(Object.create(null), {
      source: "lastUsed",
      claudeCode: Object.assign(Object.create(null), CUSTOM.claudeCode),
      codex: Object.assign(Object.create(null), CUSTOM.codex),
    });

    expect(normalizeAgentNewThreadDefaults(value)).toEqual(CUSTOM);
  });

  it("falls back to full defaults for a missing or non-record top level", () => {
    for (const malformed of [
      undefined,
      null,
      "lastUsed",
      0,
      true,
      [],
      [CUSTOM],
      ["lastUsed", CUSTOM.claudeCode, CUSTOM.codex],
      new Map(Object.entries(CUSTOM)),
      new Date(0),
      () => CUSTOM,
    ]) {
      expect(normalizeAgentNewThreadDefaults(malformed)).toEqual(DEFAULTS);
    }
  });

  it("falls back to full defaults when a top-level key is missing", () => {
    for (const malformed of [
      {},
      { claudeCode: CUSTOM.claudeCode, codex: CUSTOM.codex },
      { source: CUSTOM.source, codex: CUSTOM.codex },
      { source: CUSTOM.source, claudeCode: CUSTOM.claudeCode },
      { source: CUSTOM.source, claudeCode: CUSTOM.claudeCode, cursor: CUSTOM.codex },
    ]) {
      expect(normalizeAgentNewThreadDefaults(malformed)).toEqual(DEFAULTS);
    }
  });

  it("falls back to full defaults when the top level carries an unknown key", () => {
    expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, cursor: CUSTOM.codex })).toEqual(DEFAULTS);
    expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, token: "secret" })).toEqual(DEFAULTS);
  });

  it("falls back to the default source only when the source is invalid", () => {
    for (const source of ["LastUsed", "lastused", "", "project", null, undefined, 1, true, {}]) {
      expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, source })).toEqual({
        ...CUSTOM,
        source: "defaults",
      });
    }
  });

  it("keeps the Codex default when only the Claude model is invalid", () => {
    for (const model of [
      "gpt-5.5",
      "Claude-Opus-4-8",
      "claude-",
      "claude-opus--4",
      `claude-${"a".repeat(96)}`,
      "",
      null,
      undefined,
      7,
      ["opus"],
    ]) {
      expect(
        normalizeAgentNewThreadDefaults({ ...CUSTOM, claudeCode: { model, effort: "xhigh" } }),
      ).toEqual({ ...CUSTOM, claudeCode: DEFAULTS.claudeCode });
    }
  });

  it("keeps the Claude default when only the Codex model is invalid", () => {
    for (const model of [
      "GPT-5.5",
      "gpt 5",
      "gpt-5.",
      "-gpt",
      "a".repeat(65),
      "",
      null,
      undefined,
      7,
      ["gpt-5.5"],
    ]) {
      expect(
        normalizeAgentNewThreadDefaults({ ...CUSTOM, codex: { model, effort: "medium" } }),
      ).toEqual({ ...CUSTOM, codex: DEFAULTS.codex });
    }
  });

  it("falls back per provider when the effort is not one of its choices", () => {
    for (const effort of ["ultra", "minimal", "none", "HIGH", "", null, undefined, 3, ["high"]]) {
      expect(
        normalizeAgentNewThreadDefaults({ ...CUSTOM, claudeCode: { model: "opus", effort } }),
      ).toEqual({ ...CUSTOM, claudeCode: DEFAULTS.claudeCode });
    }
    for (const effort of ["ultrathink", "ultracode", "HIGH", "", null, undefined, 3, ["high"]]) {
      expect(
        normalizeAgentNewThreadDefaults({ ...CUSTOM, codex: { model: "gpt-5.5", effort } }),
      ).toEqual({ ...CUSTOM, codex: DEFAULTS.codex });
    }
  });

  it("falls back per provider when the provider record has the wrong shape", () => {
    for (const malformed of [
      null,
      undefined,
      "opus",
      [],
      ["opus", "high"],
      {},
      { model: "default" },
      { effort: "high" },
      { model: "default", effort: "high", mode: "bypassPermissions" },
      { model: "default", effort: "high", token: "secret" },
    ]) {
      expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, claudeCode: malformed })).toEqual({
        ...CUSTOM,
        claudeCode: DEFAULTS.claudeCode,
      });
      expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, codex: malformed })).toEqual({
        ...CUSTOM,
        codex: DEFAULTS.codex,
      });
    }
  });

  it("falls back for every invalid part at once without dropping the valid source", () => {
    expect(
      normalizeAgentNewThreadDefaults({
        source: "lastUsed",
        claudeCode: { model: "gpt-5.5", effort: "high" },
        codex: { model: "gpt-5.5", effort: "ultrathink" },
      }),
    ).toEqual({ ...DEFAULTS, source: "lastUsed" });
  });

  it("rejects prototype-polluting and inherited records", () => {
    const pollutedTopLevel = JSON.parse(
      '{"source":"lastUsed","claudeCode":{"model":"opus","effort":"max"},"codex":{"model":"gpt-5.5","effort":"low"},"__proto__":{"polluted":true}}',
    );
    const pollutedProvider = JSON.parse(
      '{"source":"lastUsed","claudeCode":{"model":"opus","effort":"max","__proto__":{"polluted":true}},"codex":{"model":"gpt-5.5","effort":"low"}}',
    );
    const constructorKey = JSON.parse(
      '{"source":"lastUsed","claudeCode":{"model":"opus","effort":"max"},"constructor":{"prototype":{"polluted":true}}}',
    );
    const inheritedTopLevel = Object.create(CUSTOM);
    const inheritedProvider = { ...CUSTOM, codex: Object.create(CUSTOM.codex) };

    expect(normalizeAgentNewThreadDefaults(pollutedTopLevel)).toEqual(DEFAULTS);
    expect(normalizeAgentNewThreadDefaults(pollutedProvider)).toEqual({
      source: "lastUsed",
      claudeCode: DEFAULTS.claudeCode,
      codex: { model: "gpt-5.5", effort: "low" },
    });
    expect(normalizeAgentNewThreadDefaults(constructorKey)).toEqual(DEFAULTS);
    expect(normalizeAgentNewThreadDefaults(inheritedTopLevel)).toEqual(DEFAULTS);
    expect(normalizeAgentNewThreadDefaults(inheritedProvider)).toEqual({
      ...CUSTOM,
      codex: DEFAULTS.codex,
    });
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(normalizeAgentNewThreadDefaults(pollutedProvider)).not.toHaveProperty("polluted");
  });

  it("never throws for a value that cannot be inspected", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(normalizeAgentNewThreadDefaults(revoked.proxy)).toEqual(DEFAULTS);
    expect(normalizeAgentNewThreadDefaults({ ...CUSTOM, claudeCode: revoked.proxy })).toEqual(
      DEFAULTS,
    );
  });

  it("does not mutate or alias its input", () => {
    const input = JSON.parse(JSON.stringify(CUSTOM));
    const snapshot = JSON.stringify(input);
    const normalized = normalizeAgentNewThreadDefaults(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(normalized.claudeCode).not.toBe(input.claudeCode);
    expect(normalized.codex).not.toBe(input.codex);
  });
});
