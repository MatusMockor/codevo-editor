import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-command-catalog-wire.json";
import {
  parseAgentCommandCatalog,
  type AgentCommandCatalog,
  type AgentCommandCatalogEntry,
} from "./agentCommandCatalog";
import {
  agentComposerInvocation,
  agentComposerMenuItemKey,
  type AgentComposerCommandToken,
} from "./agentComposerCommand";
import {
  MAX_AGENT_COMPOSER_MENU_ROWS,
  agentComposerMenu,
  agentComposerMenuNotice,
  rankAgentComposerMenu,
} from "./agentComposerCommandMenu";

const CLAUDE_BUILTINS = ["model", "permissions", "reasoning", "plan", "new", "settings", "usage"];
const claudeFixture = parseAgentCommandCatalog(wireContract.catalogs[0]?.value);
const codexFixture = parseAgentCommandCatalog(wireContract.catalogs[1]?.value);

function command(name: string, overrides: Partial<AgentCommandCatalogEntry> = {}) {
  return {
    kind: "command",
    name,
    label: null,
    description: null,
    argumentHint: null,
    builtin: false,
    ...overrides,
  };
}

function claude(entries: ReadonlyArray<unknown>, truncated = false): AgentCommandCatalog {
  return parseAgentCommandCatalog({ version: 1, provider: "claudeCode", truncated, entries });
}

function typed(query: string): AgentComposerCommandToken {
  return { query, terminated: false };
}

function keys(catalog: AgentCommandCatalog | null, query: string, followUp = false) {
  const menu = agentComposerMenu(catalog?.provider ?? "claudeCode", followUp, catalog);
  return rankAgentComposerMenu(menu, typed(query)).rows.map(agentComposerMenuItemKey);
}

describe("composer menu merge", () => {
  it("offers only built-ins without a catalog", () => {
    expect(keys(null, "")).toEqual(CLAUDE_BUILTINS);
  });

  it("lists built-ins first, then user entries, then provider built-ins, each by name", () => {
    expect(keys(claudeFixture, "")).toEqual([
      ...CLAUDE_BUILTINS,
      "command:design-login",
      "command:superpowers:brainstorming",
      "command:code-review",
    ]);
    expect(keys(codexFixture, "")).toEqual([
      "model",
      "permissions",
      "new",
      "settings",
      "usage",
      "skill:work-pets:create-pet",
      "skill:skill-creator",
    ]);
  });

  it("lets an offered built-in hide the provider entry of the same name", () => {
    const catalog = claude([command("model"), command("Usage"), command("compact"), command("pr")]);
    expect(keys(catalog, "", false)).toEqual([...CLAUDE_BUILTINS, "command:compact", "command:pr"]);
    expect(keys(catalog, "", true)).toEqual([...CLAUDE_BUILTINS, "compact", "command:pr"]);
    expect(keys(catalog, "model")).toEqual(["model"]);
  });

  it("keeps a provider entry whose built-in namesake is not offered for that provider", () => {
    const skills = parseAgentCommandCatalog({
      version: 1,
      provider: "codex",
      truncated: false,
      entries: [
        { ...command("plan"), kind: "skill" },
        { ...command("model"), kind: "skill" },
      ],
    });
    expect(keys(skills, "pla")).toEqual(["skill:plan"]);
    expect(keys(skills, "model")).toEqual(["model"]);
  });

  it("hides reserved double-underscore names even if one reaches the merge", () => {
    const catalog: AgentCommandCatalog = {
      ...claudeFixture,
      entries: [command("__internal") as AgentCommandCatalogEntry, ...claudeFixture.entries],
    };
    expect(keys(catalog, "")).not.toContain("command:__internal");
    expect(keys(catalog, "internal")).toEqual([]);
  });

  it("ignores a catalog that belongs to another provider", () => {
    const menu = agentComposerMenu("claudeCode", false, codexFixture);
    const view = rankAgentComposerMenu(menu, typed(""));
    expect(view.rows.map(agentComposerMenuItemKey)).toEqual(CLAUDE_BUILTINS);
    expect(view.incomplete).toBe(false);
  });
});

describe("composer menu ranking", () => {
  const catalog = claude([
    command("zeta", { description: "Run a review of the branch." }),
    command("preview"),
    command("team:review"),
    command("review-pr"),
    command("review"),
    command("code_review", { builtin: true }),
    command("docs.review", { builtin: true }),
    command("audit", { label: "Peer Review" }),
    command("unrelated", { description: "Nothing to see." }),
  ]);

  it("orders exact, prefix, segment, substring and description matches", () => {
    expect(keys(catalog, "review")).toEqual([
      "command:review",
      "command:review-pr",
      "command:team:review",
      "command:code_review",
      "command:docs.review",
      "command:audit",
      "command:preview",
      "command:zeta",
    ]);
  });

  it("matches case-insensitively in both directions", () => {
    const mixed = claude([command("Design-Login", { description: "Sign In" })]);
    expect(keys(mixed, "design-login")).toEqual(["command:Design-Login"]);
    expect(keys(mixed, "SIGN".toLowerCase())).toEqual(["command:Design-Login"]);
    const menu = agentComposerMenu("claudeCode", false, mixed);
    expect(rankAgentComposerMenu(menu, typed("DESIGN")).rows.map(agentComposerMenuItemKey)).toEqual(
      ["command:Design-Login"],
    );
  });

  it("recognizes every segment boundary and ranks it above a plain substring", () => {
    const segmented = claude([
      command("xlogin"),
      command("a:login"),
      command("b-login"),
      command("c_login"),
      command("d.login"),
    ]);
    expect(keys(segmented, "login")).toEqual([
      "command:a:login",
      "command:b-login",
      "command:c_login",
      "command:d.login",
      "command:xlogin",
    ]);
  });

  it("finds a later segment match after an earlier plain substring", () => {
    const repeated = claude([command("xab-ab"), command("zab")]);
    expect(keys(repeated, "ab")).toEqual(["command:xab-ab", "command:zab"]);
  });

  it("breaks ties with built-ins first, then user entries, then provider built-ins", () => {
    const tied = claude([
      command("plan-b", { builtin: true }),
      command("plan-c"),
      command("plan-a", { builtin: true }),
      command("Plan-A2"),
    ]);
    expect(keys(tied, "plan")).toEqual([
      "plan",
      "command:Plan-A2",
      "command:plan-c",
      "command:plan-a",
      "command:plan-b",
    ]);
    expect(keys(tied, "pla")).toEqual([
      "plan",
      "command:Plan-A2",
      "command:plan-c",
      "command:plan-a",
      "command:plan-b",
    ]);
  });

  it("matches built-ins by id and label only and keeps their curated order inside a tier", () => {
    expect(keys(null, "mod", true)).toEqual(["model", "plan"]);
    expect(keys(null, "capabilities", true)).toEqual([]);
    expect(keys(null, "btw", true)).toEqual([]);
    expect(keys(null, "", true)).toEqual([...CLAUDE_BUILTINS, "compact"]);
  });

  it("is deterministic regardless of the order the backend lists entries in", () => {
    const forward = keys(catalog, "re");
    const reversed = keys(claude([...catalog.entries].reverse()), "re");
    expect(reversed).toEqual(forward);
    expect(keys(catalog, "re")).toEqual(forward);
  });

  it("finds long namespaced names by any segment", () => {
    const long = claude([
      command("app-6a3293e129088191abf0875820e839da:ad-multiplier"),
      command("superpowers:brainstorming", { argumentHint: "[topic]" }),
    ]);
    expect(keys(long, "ad-mult")).toEqual([
      "command:app-6a3293e129088191abf0875820e839da:ad-multiplier",
    ]);
    expect(keys(long, "superpowers:brainstorming")).toEqual(["command:superpowers:brainstorming"]);
    expect(keys(long, "brain")).toEqual(["command:superpowers:brainstorming"]);
    expect(keys(long, "topic")).toEqual([]);
  });

  it("offers only an exact built-in once whitespace ends the slash token", () => {
    const menu = agentComposerMenu("claudeCode", true, claude([command("pr"), command("plans")]));
    const ended = (query: string) =>
      rankAgentComposerMenu(menu, { query, terminated: true }).rows.map(agentComposerMenuItemKey);
    expect(ended("compact")).toEqual(["compact"]);
    expect(ended("plan")).toEqual(["plan"]);
    expect(ended("pr")).toEqual([]);
    expect(ended("pla")).toEqual([]);
    expect(ended("")).toEqual([]);
  });
});

describe("composer menu cap and truthful truncation", () => {
  const many = (count: number, truncated = false) =>
    claude(
      Array.from({ length: count }, (_, index) => command(`cmd-${String(index).padStart(3, "0")}`)),
      truncated,
    );

  it("says nothing when every match is shown", () => {
    const view = rankAgentComposerMenu(agentComposerMenu("claudeCode", false, many(10)), typed(""));
    expect(view.rows).toHaveLength(17);
    expect(view.matched).toBe(17);
    expect(agentComposerMenuNotice(view)).toBeNull();
  });

  it("caps the rows and reports how many matches the cap hides", () => {
    const menu = agentComposerMenu("claudeCode", false, many(205));
    const view = rankAgentComposerMenu(menu, typed(""));
    expect(MAX_AGENT_COMPOSER_MENU_ROWS).toBe(50);
    expect(view.rows).toHaveLength(50);
    expect(view.matched).toBe(212);
    expect(agentComposerMenuNotice(view)).toBe("Showing 50 of 212. Keep typing to narrow.");
    expect(view.rows.slice(0, 7).map(agentComposerMenuItemKey)).toEqual(CLAUDE_BUILTINS);
    expect(view.rows.slice(7).map(agentComposerInvocation)[0]).toBe("/cmd-000");
  });

  it("drops the notice once typing narrows the matches under the cap", () => {
    const menu = agentComposerMenu("claudeCode", false, many(205));
    const view = rankAgentComposerMenu(menu, typed("cmd-20"));
    expect(view.rows.map(agentComposerInvocation)).toEqual([
      "/cmd-200",
      "/cmd-201",
      "/cmd-202",
      "/cmd-203",
      "/cmd-204",
    ]);
    expect(agentComposerMenuNotice(view)).toBeNull();
  });

  it("never presents a backend-truncated catalog as complete", () => {
    const menu = agentComposerMenu("claudeCode", false, many(3, true));
    const all = rankAgentComposerMenu(menu, typed(""));
    expect(all.incomplete).toBe(true);
    expect(agentComposerMenuNotice(all)).toBe(
      "Some commands are not listed. Type the full name to use one.",
    );
    const narrowed = rankAgentComposerMenu(menu, typed("cmd-001"));
    expect(narrowed.rows).toHaveLength(1);
    expect(agentComposerMenuNotice(narrowed)).not.toBeNull();
  });

  it("reports a lower bound when both the cap and the backend hide matches", () => {
    const menu = agentComposerMenu("claudeCode", false, many(205, true));
    const view = rankAgentComposerMenu(menu, typed(""));
    expect(agentComposerMenuNotice(view)).toBe("Showing 50 of 212 or more. Keep typing to narrow.");
  });

  it("honors the contract's truncated fixture and a custom cap", () => {
    const fixture = parseAgentCommandCatalog(wireContract.catalogs[3]?.value);
    const menu = agentComposerMenu("claudeCode", false, fixture);
    const view = rankAgentComposerMenu(menu, typed(""), 3);
    expect(view.rows.map(agentComposerMenuItemKey)).toEqual(["model", "permissions", "reasoning"]);
    expect(view.matched).toBe(8);
    expect(agentComposerMenuNotice(view)).toBe("Showing 3 of 8 or more. Keep typing to narrow.");
    expect(rankAgentComposerMenu(menu, typed(""), 0).rows).toEqual([]);
  });

  it("ranks the largest catalog the contract allows without dropping or duplicating entries", () => {
    const menu = agentComposerMenu("claudeCode", false, many(wireContract.limits.maxEntries));
    const view = rankAgentComposerMenu(menu, typed("cmd"), wireContract.limits.maxEntries);
    expect(view.matched).toBe(wireContract.limits.maxEntries);
    expect(new Set(view.rows.map(agentComposerMenuItemKey)).size).toBe(
      wireContract.limits.maxEntries,
    );
  });
});
