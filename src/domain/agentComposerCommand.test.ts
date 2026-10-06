import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/agent-command-catalog-wire.json";
import { parseAgentCommandCatalog } from "./agentCommandCatalog";
import {
  agentComposerCommandQuery,
  agentComposerCommandToken,
  agentComposerCommands,
  agentComposerInsertion,
  agentComposerInvocation,
  agentComposerMenuItemKey,
} from "./agentComposerCommand";

const MAX_NAME = wireContract.limits.maxNameBytes;
const claudeEntries = parseAgentCommandCatalog(wireContract.catalogs[0]?.value).entries;
const codexEntries = parseAgentCommandCatalog(wireContract.catalogs[1]?.value).entries;

describe("composer command discovery", () => {
  it("limits provider actions to their implemented provider and session scope", () => {
    expect(agentComposerCommands("codex", true).map(({ id }) => id)).toEqual([
      "model",
      "permissions",
      "new",
      "settings",
      "usage",
    ]);
    expect(agentComposerCommands("claudeCode", false).map(({ id }) => id)).not.toContain("compact");
    expect(agentComposerCommands("claudeCode", true).map(({ id }) => id)).toEqual([
      "model",
      "permissions",
      "reasoning",
      "plan",
      "new",
      "settings",
      "usage",
      "compact",
    ]);
    expect(agentComposerCommands("claudeCode", true).every(({ kind }) => kind === "builtin")).toBe(
      true,
    );
  });

  it("offers /usage for both providers", () => {
    expect(agentComposerCommands("codex", false).map((command) => command.id)).toContain("usage");
    expect(agentComposerCommands("claudeCode", true).map((command) => command.id)).toContain(
      "usage",
    );
  });

  it.each([
    ["/", ""],
    ["/mod", "mod"],
    ["/MODEL", "model"],
    ["/plan ", "plan"],
    ["/compact ", "compact"],
    ["/compact\t", "compact"],
    ["/superpowers:brainstorming", "superpowers:brainstorming"],
    [
      "/app-6a3293e129088191abf0875820e839da:ad-multiplier",
      "app-6a3293e129088191abf0875820e839da:ad-multiplier",
    ],
    ["/v1.2_beta", "v1.2_beta"],
    ["/Design-Login", "design-login"],
    [`/${"a".repeat(MAX_NAME)}`, "a".repeat(MAX_NAME)],
    [`/${"a".repeat(MAX_NAME)} `, "a".repeat(MAX_NAME)],
  ])("recognizes a command query %s", (prompt, expected) => {
    expect(agentComposerCommandQuery(prompt)).toBe(expected);
  });

  it.each([
    "",
    "hello /model",
    " /model",
    "/model opus",
    "/model  ",
    "/tmp/project",
    "/model\n",
    "/model\nother text",
    "//model",
    "```/model```",
    "/é",
    "/a$b",
    "$skill",
    `/${"a".repeat(MAX_NAME + 1)}`,
    `/${"a".repeat(MAX_NAME + 1)} `,
    `/${"a".repeat(100_000)}`,
  ])("leaves ordinary text unchanged: %s", (prompt) => {
    expect(agentComposerCommandQuery(prompt)).toBeNull();
    expect(agentComposerCommandToken(prompt)).toBeNull();
  });

  it("accepts every character of the contract name alphabet in a query", () => {
    const alphabet = "ABCXYZabcxyz0189:_.-";
    expect(new RegExp(wireContract.limits.namePattern).test(`a${alphabet}`)).toBe(true);
    expect(agentComposerCommandQuery(`/${alphabet}`)).toBe(alphabet.toLowerCase());
  });

  it("reports whether the slash token was ended by whitespace", () => {
    expect(agentComposerCommandToken("/compact")).toEqual({ query: "compact", terminated: false });
    expect(agentComposerCommandToken("/compact ")).toEqual({ query: "compact", terminated: true });
    expect(agentComposerCommandToken("/")).toEqual({ query: "", terminated: false });
    expect(agentComposerCommandToken("/ ")).toEqual({ query: "", terminated: true });
  });
});

describe("composer menu item identity", () => {
  it("invokes Claude commands with a slash and Codex skills with a dollar", () => {
    expect(claudeEntries.map(agentComposerInvocation)).toEqual([
      "/design-login",
      "/superpowers:brainstorming",
      "/code-review",
    ]);
    expect(codexEntries.map(agentComposerInvocation)).toEqual([
      "$work-pets:create-pet",
      "$skill-creator",
    ]);
    expect(agentComposerCommands("codex", false).map(agentComposerInvocation)).toContain("/model");
  });

  it("inserts the invocation followed by one space", () => {
    expect(claudeEntries.map(agentComposerInsertion)[1]).toBe("/superpowers:brainstorming ");
    expect(codexEntries.map(agentComposerInsertion)[0]).toBe("$work-pets:create-pet ");
  });

  it("keeps built-in keys stable and never lets a provider entry collide with them", () => {
    const builtins = agentComposerCommands("claudeCode", true);
    const shadow = { ...claudeEntries[0]!, name: "model" };
    const skill = { ...codexEntries[0]!, name: "model" };
    const keys = [...builtins, shadow, skill, ...claudeEntries].map(agentComposerMenuItemKey);
    expect(keys.slice(0, builtins.length)).toEqual(builtins.map(({ id }) => id));
    expect(keys).toContain("command:model");
    expect(keys).toContain("skill:model");
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => !/\s/.test(key))).toBe(true);
  });
});
