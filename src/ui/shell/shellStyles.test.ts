import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
  type CssRule,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const shellRules = parsed.rules.filter((rule) => rule.sheet === "ui/shell/shell.css");
const declared = new Set(
  parsed.rules
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);
const LEGACY_TOKEN = /var\(\s*--(color|agent|codevo|settings|toast|change|window)-/;
const MOTION_PROPERTIES = new Set(["transition", "transition-duration", "animation"]);
const MOTION_TOKEN = /var\(--cv-motion-(fast|base|slow|spin)\)/;
const CLASS_NAME = /\.(-?[_a-zA-Z][\w-]*)/g;

function declaration(rules: readonly CssRule[], selector: string, property: string) {
  return lastOf(
    buildTokenTable(
      rules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      ),
      "",
    ).get(property),
  );
}

describe("shell stylesheet", () => {
  it("parses and paints only through declared --cv tokens", () => {
    expect(parsed.issues).toEqual([]);
    expect(shellRules.length).toBeGreaterThan(0);
    const literals = shellRules.flatMap((rule) =>
      rule.declarations
        .filter((entry) => COLOR_LITERAL.test(entry.value))
        .map((entry) => `${rule.selector} ${entry.property}`),
    );
    const undeclared = shellRules.flatMap((rule) =>
      rule.declarations.flatMap((entry) =>
        varReferences(entry.value)
          .filter((name) => name.startsWith("--cv-") && !declared.has(name))
          .map((name) => `${rule.selector} ${name}`),
      ),
    );
    const legacy = shellRules.flatMap((rule) =>
      rule.declarations
        .filter((entry) => LEGACY_TOKEN.test(entry.value))
        .map((entry) => `${rule.selector} ${entry.property}`),
    );

    expect(literals).toEqual([]);
    expect(undeclared).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it("animates only through motion tokens and namespaces every class", () => {
    const motion = shellRules.flatMap((rule) =>
      rule.declarations
        .filter((entry) => MOTION_PROPERTIES.has(entry.property) && entry.value !== "none")
        .filter((entry) => !MOTION_TOKEN.test(entry.value))
        .map((entry) => `${rule.selector}: ${entry.value}`),
    );
    const foreign = shellRules
      .flatMap((rule) => selectorParts(rule.selector))
      .flatMap((part) => [...part.matchAll(CLASS_NAME)].map((match) => match[1] ?? ""))
      .filter((name) => !name.startsWith("cv-"));

    expect(motion).toEqual([]);
    expect(foreign).toEqual([]);
  });

  it("sizes every bar at the 52px top bar token and clears the traffic lights at the window edge", () => {
    expect(declaration(shellRules, ".cv-topbar", "height")).toBe("var(--cv-topbar-h)");
    expect(
      (declaration(shellRules, ".cv-topbar--window-edge", "padding-left") ?? "").replace(
        /\s+/g,
        "",
      ),
    ).toBe(
      "max(var(--shell-topbar-pad),calc(var(--shell-window-inset,0px)-var(--shell-sidebar-track,0px)))",
    );
    const hidesActions = shellRules.filter(
      (rule) =>
        selectorParts(rule.selector).some((part) => part.includes(".cv-topbar__actions")) &&
        rule.declarations.some(
          (entry) => entry.property === "opacity" || entry.property === "visibility",
        ),
    );
    expect(hidesActions).toEqual([]);
  });

  it("feeds the window inset and the sidebar track from the app shell and the agent frame", () => {
    const appShell = parsed.rules.filter((rule) => rule.sheet === "App.css");
    const frame = parsed.rules.filter(
      (rule) => rule.sheet === "components/workbenchShellFrame.css",
    );

    expect(declaration(appShell, ".app-shell", "--shell-window-inset")).toBe(
      "var(--window-native-controls-inset)",
    );
    expect(
      declaration(frame, '.workbench-frame[data-layout="agent"]', "--shell-sidebar-track"),
    ).toBe("var(--agent-rail-track)");
  });
});
