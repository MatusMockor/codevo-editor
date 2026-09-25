import { describe, expect, it } from "vitest";
import {
  LEGACY_BORDER_RATCHET,
  PENDING_SCOPE,
  SEPARATOR_INSET_CONSUMERS,
  type BorderRuleEntry,
} from "./cssBorderAllowlist";
import {
  TOKEN_SHEETS,
  borderRuleKey,
  buildTokenTable,
  collectBorderViolations,
  parseAllStyleSheets,
  varReferences,
  type CssRule,
} from "./cssContractTestSupport";

const RATCHET_FROZEN_SIZE = 138;
const RATCHET_SHEETS = [
  "App.css",
  "components/DirtyCloseDecisionDialogHost.css",
  "components/ExternalFileConflict.css",
  "components/PhpChangeSignatureDialog.css",
] as const;

const parsed = parseAllStyleSheets();
const tokenTable = buildTokenTable(
  parsed.rules.filter((rule) => (TOKEN_SHEETS as readonly string[]).includes(rule.sheet)),
);
const violations = collectBorderViolations(parsed.rules, tokenTable);
const violatingKeys = new Set(violations.map((violation) => entryKey(violation)));
const ratchetKeys = new Set(LEGACY_BORDER_RATCHET.map(entryKey));
const pendingKeys = new Set(PENDING_SCOPE.map(entryKey));

function entryKey(entry: BorderRuleEntry): string {
  return `${entry.sheet}\u0000${entry.selector}`;
}

function ruleEntry(rule: CssRule): BorderRuleEntry {
  return { sheet: rule.sheet, selector: borderRuleKey(rule) };
}

function describeEntry(entry: BorderRuleEntry): string {
  return `${entry.sheet} :: ${entry.selector}`;
}

const QUEUED_BUBBLE_SHEET = "components/agentMode/conversation/conversation.css";
const QUEUED_BUBBLE_SELECTOR = ".agent-prompt--queued .agent-prompt__bubble";
const AGENT_PROSE_SHEET = "components/agentMode/conversation/agentProse.css";
const AGENT_PROSE_INLINE_SELECTORS = [".agent-md__inline-code", ".agent-md__path-link"] as const;

describe("css border contract", () => {
  it("parses every stylesheet under src without issues", () => {
    expect(parsed.issues).toEqual([]);
    expect(parsed.rules.length).toBeGreaterThan(0);
  });

  it("keeps the ratchet and the pending scope disjoint and free of duplicates", () => {
    const duplicates = [...LEGACY_BORDER_RATCHET, ...PENDING_SCOPE]
      .map(entryKey)
      .filter((key, index, keys) => keys.indexOf(key) !== index);

    expect(duplicates).toEqual([]);
  });

  it("limits the ratchet to the legacy workbench sheets", () => {
    const foreign = LEGACY_BORDER_RATCHET.filter(
      (entry) => !(RATCHET_SHEETS as readonly string[]).includes(entry.sheet),
    ).map(describeEntry);

    expect(foreign).toEqual([]);
  });

  it("rejects borders, outlines and shadows outside the ratchet and pending scope", () => {
    const unexpected = violations
      .filter((violation) => {
        const key = entryKey(violation);
        return !ratchetKeys.has(key) && !pendingKeys.has(key);
      })
      .map(
        (violation) =>
          `${describeEntry(violation)} :: ${violation.kind} ${violation.property}: ${violation.value}`,
      );

    expect(unexpected).toEqual([]);
  });

  it("outlines the queued message bubble with the strong hairline ring token only", () => {
    const queued = parsed.rules.filter(
      (rule) =>
        rule.sheet === QUEUED_BUBBLE_SHEET && borderRuleKey(rule) === QUEUED_BUBBLE_SELECTOR,
    );
    const edges = queued
      .flatMap((rule) => rule.declarations)
      .filter(
        (declaration) =>
          declaration.property === "box-shadow" || /^(border|outline)/.test(declaration.property),
      )
      .map((declaration) => `${declaration.property}: ${declaration.value}`);

    expect(edges).toEqual(["box-shadow: var(--cv-ring-hair-strong)"]);
  });

  it("keeps inline code and local file links in agent prose free of borders and rings", () => {
    const edges = parsed.rules
      .filter((rule) => rule.sheet === AGENT_PROSE_SHEET)
      .filter((rule) =>
        AGENT_PROSE_INLINE_SELECTORS.some((selector) => rule.selector.includes(selector)),
      )
      .filter((rule) => !rule.selector.includes(":focus-visible"))
      .flatMap((rule) =>
        rule.declarations
          .filter(
            (declaration) =>
              declaration.property === "box-shadow" ||
              /^(border|outline)(?!-radius)/.test(declaration.property),
          )
          .map((declaration) => `${rule.selector} :: ${declaration.property}`),
      );

    expect(edges).toEqual([]);
  });

  it("only shrinks the ratchet: every entry still declares a border", () => {
    const stale = LEGACY_BORDER_RATCHET.filter((entry) => !violatingKeys.has(entryKey(entry))).map(
      describeEntry,
    );

    expect(stale).toEqual([]);
  });

  it("drops pending entries as soon as their borders are gone", () => {
    const stale = PENDING_SCOPE.filter((entry) => !violatingKeys.has(entryKey(entry))).map(
      describeEntry,
    );

    expect(stale).toEqual([]);
  });

  it("keeps the pending scope empty", () => {
    expect(PENDING_SCOPE.map(describeEntry)).toEqual([]);
  });

  it("never grows the ratchet past its frozen size", () => {
    expect(LEGACY_BORDER_RATCHET.length).toBeLessThanOrEqual(RATCHET_FROZEN_SIZE);
  });

  it("allows the separator inset only on the fixed consumer list", () => {
    const allowed = new Set(SEPARATOR_INSET_CONSUMERS.map(entryKey));
    const consumers = parsed.rules
      .filter((rule) =>
        rule.declarations.some(
          (declaration) =>
            declaration.property === "box-shadow" &&
            varReferences(declaration.value).some((name) => name.includes("separator")),
        ),
      )
      .map(ruleEntry)
      .filter((entry) => !allowed.has(entryKey(entry)))
      .map(describeEntry);

    expect(consumers).toEqual([]);
  });

  it("keeps outlines exclusively under :focus-visible", () => {
    const outlines = violations
      .filter((violation) => violation.kind === "outline")
      .filter((violation) => !pendingKeys.has(entryKey(violation)))
      .filter((violation) => !ratchetKeys.has(entryKey(violation)))
      .map(describeEntry);

    expect(outlines).toEqual([]);
  });
});
