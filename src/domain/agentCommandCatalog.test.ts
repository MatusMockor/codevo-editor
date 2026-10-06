import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-command-catalog-wire.json";
import {
  AGENT_COMMAND_CATALOG_LIMITS,
  AGENT_COMMAND_NAME_PATTERN,
  agentCommandCatalogEntryKind,
  agentCommandCatalogRequest,
  parseAgentCommandCatalog,
  parseAgentCommandCatalogRequest,
  sameAgentCommandCatalog,
} from "./agentCommandCatalog";

const LIMITS = AGENT_COMMAND_CATALOG_LIMITS;

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "command",
    name: "pr",
    label: null,
    description: null,
    argumentHint: null,
    builtin: false,
    ...overrides,
  };
}

function claude(entries: ReadonlyArray<unknown>): Record<string, unknown> {
  return { version: 1, provider: "claudeCode", truncated: false, entries };
}

describe("agent command catalog wire contract", () => {
  it("keeps the domain limits and name alphabet identical to the shared contract", () => {
    const { namePattern, ...limits } = wireContract.limits;
    expect(wireContract.schemaVersion).toBe(1);
    expect({ ...LIMITS }).toEqual(limits);
    expect(AGENT_COMMAND_NAME_PATTERN.source).toBe(namePattern);
    expect(AGENT_COMMAND_NAME_PATTERN.flags).toBe("");
  });

  it.each(wireContract.catalogs)("accepts the $name fixture unchanged", ({ value }) => {
    const parsed = parseAgentCommandCatalog(value);
    expect(parsed).toEqual(value);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.entries)).toBe(true);
    expect(parsed.entries.every((item) => Object.isFrozen(item))).toBe(true);
  });

  it.each(wireContract.rejectedCatalogs)("rejects the $name fixture", ({ value }) => {
    expect(() => parseAgentCommandCatalog(value)).toThrow(TypeError);
  });

  it.each(wireContract.requests)("accepts the $name request", ({ value }) => {
    expect(parseAgentCommandCatalogRequest(value)).toEqual(value);
  });

  it.each(wireContract.rejectedRequests)("rejects the $name request", ({ value }) => {
    expect(() => parseAgentCommandCatalogRequest(value)).toThrow(TypeError);
  });

  it("pairs each provider with the only entry kind it may publish", () => {
    expect(agentCommandCatalogEntryKind("claudeCode")).toBe("command");
    expect(agentCommandCatalogEntryKind("codex")).toBe("skill");
  });
});

describe("agent command catalog parser", () => {
  it.each([null, undefined, 1, "catalog", [], [claude([])]])("rejects a non-object %j", (value) => {
    expect(() => parseAgentCommandCatalog(value)).toThrow(TypeError);
  });

  it("measures text limits in UTF-8 bytes rather than UTF-16 units", () => {
    const twoByte = "é";
    const fits = twoByte.repeat(LIMITS.maxDescriptionBytes / 2);
    const overflows = twoByte.repeat(LIMITS.maxDescriptionBytes / 2 + 1);
    expect(overflows.length).toBeLessThan(LIMITS.maxDescriptionBytes);
    expect(parseAgentCommandCatalog(claude([entry({ description: fits })])).entries).toHaveLength(
      1,
    );
    expect(() => parseAgentCommandCatalog(claude([entry({ description: overflows })]))).toThrow(
      TypeError,
    );
  });

  it.each([
    ["label", LIMITS.maxLabelBytes],
    ["description", LIMITS.maxDescriptionBytes],
    ["argumentHint", LIMITS.maxArgumentHintBytes],
  ] as const)("bounds %s at its exact byte limit", (field, limit) => {
    const atLimit = parseAgentCommandCatalog(claude([entry({ [field]: "a".repeat(limit) })]));
    expect(atLimit.entries[0]?.[field]).toHaveLength(limit);
    expect(() =>
      parseAgentCommandCatalog(claude([entry({ [field]: "a".repeat(limit + 1) })])),
    ).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog(claude([entry({ [field]: "" })]))).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog(claude([entry({ [field]: 7 })]))).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog(claude([entry({ [field]: undefined })]))).toThrow(
      TypeError,
    );
  });

  it.each(["\u0000", "\t", "\r", "\u001b", "\u007f", "\u0085"])(
    "rejects the control character %j in every text field",
    (control) => {
      for (const field of ["label", "description", "argumentHint"]) {
        expect(() =>
          parseAgentCommandCatalog(claude([entry({ [field]: `a${control}b` })])),
        ).toThrow(TypeError);
      }
    },
  );

  it("accepts real namespaced names and bounds the name length", () => {
    const names = [
      "superpowers:brainstorming",
      "app-6a3293e129088191abf0875820e839da:ad-multiplier",
      "v1.2_beta",
      "A",
      "a".repeat(LIMITS.maxNameBytes),
    ];
    const parsed = parseAgentCommandCatalog(claude(names.map((name) => entry({ name }))));
    expect(parsed.entries.map((item) => item.name)).toEqual(names);
    expect(() =>
      parseAgentCommandCatalog(claude([entry({ name: "a".repeat(LIMITS.maxNameBytes + 1) })])),
    ).toThrow(TypeError);
  });

  it.each(["__internal", "-flag", ":scope", ".hidden", "a b", "a/b", "$pdf", "é", "a\n", 7, null])(
    "rejects the name %j",
    (name) => {
      expect(() => parseAgentCommandCatalog(claude([entry({ name })]))).toThrow(TypeError);
    },
  );

  it("bounds the entry count and rejects the whole payload beyond it", () => {
    const entries = Array.from({ length: LIMITS.maxEntries + 1 }, (_, index) =>
      entry({ name: `command-${index}` }),
    );
    expect(parseAgentCommandCatalog(claude(entries.slice(0, -1))).entries).toHaveLength(
      LIMITS.maxEntries,
    );
    expect(() => parseAgentCommandCatalog(claude(entries))).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog({ ...claude([]), entries: {} })).toThrow(TypeError);
  });

  it("rejects one bad entry instead of dropping it", () => {
    expect(() =>
      parseAgentCommandCatalog(claude([entry(), entry({ name: "ok", builtin: 1 })])),
    ).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog(claude([entry(), "pr"]))).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog({ ...claude([]), truncated: "no" })).toThrow(TypeError);
    expect(() => parseAgentCommandCatalog({ ...claude([]), version: "1" })).toThrow(TypeError);
  });

  it("treats names that differ only by case as distinct commands", () => {
    const parsed = parseAgentCommandCatalog(claude([entry({ name: "PR" }), entry({ name: "pr" })]));
    expect(parsed.entries.map((item) => item.name)).toEqual(["PR", "pr"]);
  });

  it("never leaks rejected payload text into the error", () => {
    const secret = "secret payload";
    let message = "";
    try {
      parseAgentCommandCatalog(claude([entry({ name: secret })]));
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("entries[0].name");
    expect(message).not.toContain(secret);
  });
});

describe("agent command catalog request", () => {
  it("builds a request only for an absolute, bounded workspace root", () => {
    expect(agentCommandCatalogRequest("/Users/dev/project", "codex")).toEqual({
      repositoryRoot: "/Users/dev/project",
      provider: "codex",
    });
    expect(agentCommandCatalogRequest("C:\\dev\\project", "claudeCode")).not.toBeNull();
    expect(agentCommandCatalogRequest("\\\\host\\share", "claudeCode")).not.toBeNull();
    expect(agentCommandCatalogRequest(null, "codex")).toBeNull();
    expect(agentCommandCatalogRequest("", "codex")).toBeNull();
    expect(agentCommandCatalogRequest("project", "codex")).toBeNull();
    expect(agentCommandCatalogRequest("./project", "codex")).toBeNull();
    expect(agentCommandCatalogRequest("/dev/a\nb", "codex")).toBeNull();
  });

  it("bounds the root in UTF-8 bytes", () => {
    const atLimit = `/${"a".repeat(LIMITS.maxRepositoryRootBytes - 1)}`;
    expect(agentCommandCatalogRequest(atLimit, "codex")).not.toBeNull();
    expect(agentCommandCatalogRequest(`${atLimit}a`, "codex")).toBeNull();
    const multibyte = `/${"é".repeat(LIMITS.maxRepositoryRootBytes / 2)}`;
    expect(multibyte.length).toBeLessThan(LIMITS.maxRepositoryRootBytes);
    expect(agentCommandCatalogRequest(multibyte, "codex")).toBeNull();
  });
});

describe("agent command catalog equality", () => {
  const first = parseAgentCommandCatalog(wireContract.catalogs[0]?.value);

  it("recognizes a re-read catalog with identical content", () => {
    expect(sameAgentCommandCatalog(first, first)).toBe(true);
    expect(
      sameAgentCommandCatalog(first, parseAgentCommandCatalog(wireContract.catalogs[0]?.value)),
    ).toBe(true);
  });

  it.each([
    ["truncation", { truncated: true }],
    ["a removed entry", { entries: first.entries.slice(1) }],
    ["a reordered list", { entries: [...first.entries].reverse() }],
    [
      "a changed description",
      { entries: first.entries.map((item) => ({ ...item, description: "Changed." })) },
    ],
  ])("detects %s", (_name, change) => {
    expect(sameAgentCommandCatalog(first, { ...first, ...change })).toBe(false);
  });

  it("never equates catalogs of different providers", () => {
    const empty = parseAgentCommandCatalog({ ...claude([]) });
    expect(sameAgentCommandCatalog(empty, { ...empty, provider: "codex" })).toBe(false);
  });
});
