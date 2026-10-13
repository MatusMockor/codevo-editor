import { describe, expect, it } from "vitest";
import {
  lastOf,
  parseAllStyleSheets,
  parseCssRules,
  selectorParts,
  type CssRule,
} from "./cssContractTestSupport";

interface SelectorStep {
  readonly combinator: string;
  readonly compound: string;
}

const FRAME_CLASS = /\.workbench-frame(?![\w-])/;
const SLOT_ATTRIBUTE = /\[data-slot[\]=~|^$*]/;
const COMBINATOR = /[\s>+~]/;
const OVERFLOW_PROPERTIES = [
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-block",
  "overflow-inline",
];
const CLIPPED = "overflow: hidden; overflow: clip";
const AGENT_SLOT = '.workbench-frame[data-layout="agent"] > [data-slot="agent"]';
const REQUIRED_CLIPPED_SELECTORS = [
  '.workbench-frame[data-layout="agent"]',
  AGENT_SLOT,
  '.workbench-frame[data-surface="settings"]',
  '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] > [data-slot="agent"]',
  '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] > [data-slot="bottom"]',
];
const SCROLL_RESTORING_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["a selector list shared with another box", `${AGENT_SLOT}, .another-box { overflow: hidden; }`],
  ["an ancestor-qualified slot", `.app-shell ${AGENT_SLOT} { overflow: hidden; }`],
  [
    "an ancestor-qualified frame",
    '.app-shell--agent-mode .workbench-frame[data-layout="agent"] { overflow: auto; }',
  ],
  ["a slot matched without its frame", '.agent-mode[data-slot="agent"] { overflow-y: auto; }'],
  [
    "a frame child matched by class",
    ".workbench-frame > .workbench-frame__bottom { overflow: scroll; }",
  ],
  [
    "an inline-axis longhand after the clip",
    `${AGENT_SLOT} { overflow: hidden; overflow: clip; overflow-inline: auto; }`,
  ],
  [
    "a block-axis longhand after the clip",
    `${AGENT_SLOT} { overflow: hidden; overflow: clip; overflow-block: scroll; }`,
  ],
  ["a clip without the hidden fallback", `${AGENT_SLOT} { overflow: clip; }`],
  [
    "a rule nested in a media query",
    '@media (max-width: 720px) { .workbench-frame[data-layout="agent"] { overflow: hidden; } }',
  ],
  ["an important override", `${AGENT_SLOT} { overflow: hidden !important; overflow: clip; }`],
];
const UNRELATED_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  [
    "a descendant of the frame",
    '.workbench-frame[data-right-panel="maximized"] .agent-mode__center { overflow: hidden; }',
  ],
  ["a grandchild of the frame", `${AGENT_SLOT} > * { overflow: auto; }`],
  ["a box that only excludes the frame", ".panel:not(.workbench-frame) { overflow: hidden; }"],
  ["a frame pseudo-element", ".workbench-frame::before { overflow: hidden; }"],
  ["a box inside a slot class", ".workbench-frame__bottom .bottom-panel { overflow: hidden; }"],
  ["a sibling after the frame", ".workbench-frame + .status { overflow: auto; }"],
  ["a shared list that keeps the clip", `${AGENT_SLOT}, .another-box { ${CLIPPED}; }`],
  ["a slot rule without overflow", `${AGENT_SLOT} { min-height: 0; text-overflow: ellipsis; }`],
];

const parsed = parseAllStyleSheets();

function selectorSteps(member: string): readonly SelectorStep[] {
  const steps: SelectorStep[] = [];
  let depth = 0;
  let quote: string | null = null;
  let combinator = "";
  let compound = "";
  for (const character of `${member.trim()} `) {
    if (quote !== null) {
      compound += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      compound += character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (depth > 0 || !COMBINATOR.test(character)) {
      compound += character;
      continue;
    }
    if (compound !== "") {
      steps.push({ combinator, compound });
      combinator = "";
      compound = "";
    }
    if (character.trim() !== "") {
      combinator = character;
      continue;
    }
    if (combinator === "") combinator = " ";
  }
  return steps;
}

function withoutArguments(compound: string): string {
  let depth = 0;
  let bare = "";
  for (const character of compound) {
    if (character === "(") depth += 1;
    if (depth === 0) bare += character;
    if (character === ")") depth -= 1;
  }
  return bare;
}

function isElementBox(compound: string): boolean {
  return !withoutArguments(compound).includes("::");
}

function isFrame(compound: string): boolean {
  return isElementBox(compound) && FRAME_CLASS.test(withoutArguments(compound));
}

function targetsFrameOrSlot(member: string): boolean {
  const steps = selectorSteps(member);
  const subject = lastOf(steps);
  if (subject === undefined) return false;
  if (!isElementBox(subject.compound)) return false;
  if (isFrame(subject.compound)) return true;
  if (SLOT_ATTRIBUTE.test(withoutArguments(subject.compound))) return true;
  if (subject.combinator !== ">") return false;
  const parent = steps[steps.length - 2];
  if (parent === undefined) return false;
  return isFrame(parent.compound);
}

function frameMembers(rule: CssRule): readonly string[] {
  return selectorParts(rule.selector).filter(targetsFrameOrSlot);
}

function overflowValues(rule: CssRule): string {
  return rule.declarations
    .filter((declaration) => OVERFLOW_PROPERTIES.includes(declaration.property))
    .map((declaration) => `${declaration.property}: ${declaration.value}`)
    .join("; ");
}

function frameOverflowRules(rules: readonly CssRule[]): readonly CssRule[] {
  return rules.filter((rule) => frameMembers(rule).length > 0 && overflowValues(rule) !== "");
}

function scrollRestoringRules(rules: readonly CssRule[]): readonly string[] {
  return frameOverflowRules(rules)
    .filter((rule) => overflowValues(rule) !== CLIPPED)
    .map((rule) => `${rule.sheet} ${rule.selector} { ${overflowValues(rule)} }`);
}

function fixtureRules(source: string): readonly CssRule[] {
  const fixture = parseCssRules(source, "fixture.css");
  expect(fixture.issues).toEqual([]);
  expect(fixture.rules).toHaveLength(1);
  return fixture.rules;
}

describe("workbench frame scroll containment contract", () => {
  it("parses every style sheet", () => {
    expect(parsed.issues).toEqual([]);
  });

  it("clips the frame and its slots with a hidden fallback and never makes them scrollable", () => {
    expect(scrollRestoringRules(parsed.rules)).toEqual([]);
  });

  it("covers the agent frame, the agent slot and the settings and maximized variants", () => {
    const clipped = new Set(frameOverflowRules(parsed.rules).flatMap(frameMembers));

    expect(REQUIRED_CLIPPED_SELECTORS.filter((selector) => !clipped.has(selector))).toEqual([]);
  });

  it("splits a selector into compounds without breaking attribute values or arguments", () => {
    expect(
      selectorSteps('.app-shell .workbench-frame[data-x="a > b"]:has(> .c)>[data-slot="agent"]'),
    ).toEqual([
      { combinator: "", compound: ".app-shell" },
      { combinator: " ", compound: '.workbench-frame[data-x="a > b"]:has(> .c)' },
      { combinator: ">", compound: '[data-slot="agent"]' },
    ]);
  });

  it.each(SCROLL_RESTORING_FIXTURES)("rejects %s", (_name, source) => {
    expect(scrollRestoringRules(fixtureRules(source))).toHaveLength(1);
  });

  it.each(UNRELATED_FIXTURES)("ignores %s", (_name, source) => {
    expect(scrollRestoringRules(fixtureRules(source))).toEqual([]);
  });
});
