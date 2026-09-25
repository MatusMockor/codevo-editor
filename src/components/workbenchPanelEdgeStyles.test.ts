import { describe, expect, it } from "vitest";
import {
  TOKEN_SHEETS,
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "./cssContractTestSupport";

const parsed = parseAllStyleSheets();
const tokens = buildTokenTable(
  parsed.rules.filter((rule) => (TOKEN_SHEETS as readonly string[]).includes(rule.sheet)),
);
const EDGE_WIDTH = "var(--agent-surface-edge-width)";
const DOCKED_EDITOR_SLOT = '.workbench-frame[data-layout="agent"] > [data-slot="editor"]';
const MAXIMIZED_SURFACE =
  '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] .agent-surface';
const CHROME_SHEETS = [
  "components/workbenchShellFrame.css",
  "components/agentMode/",
  "components/editorPanel/",
  "ui/shell/",
] as const;

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function unconditional(selector: string): readonly CssRule[] {
  const wanted = compact(selector);
  return parsed.rules.filter(
    (rule) =>
      rule.context.length === 0 &&
      selectorParts(rule.selector).some((part) => compact(part) === wanted),
  );
}

function winning(selector: string, property: string): string | undefined {
  return lastOf(
    unconditional(selector).flatMap((rule) =>
      rule.declarations
        .filter((declaration) => declaration.property === property)
        .map((declaration) => declaration.value),
    ),
  );
}

describe("right panel edge and hairlines", () => {
  it("sizes the panel edge from the one inset the start divider token paints", () => {
    expect(lastOf(tokens.get("--cv-edge-start-divider"))).toBe("inset 1px 0 0 var(--cv-divider)");
    expect(winning(".app-shell", "--agent-surface-edge-width")).toBe("1px");
  });

  it("keeps the panel edge column clear of every surface child so the line runs unbroken", () => {
    expect(winning(".agent-surface", "box-shadow")).toBe("var(--cv-edge-start-divider)");
    expect(winning(".agent-surface", "padding-left")).toBe(EDGE_WIDTH);
    expect(winning(".agent-surface__resize", "left")).toBe("-4px");
  });

  it("stops the editor overlay short of the panel edge instead of painting over it", () => {
    expect(winning(DOCKED_EDITOR_SLOT, "padding-left")).toBe(EDGE_WIDTH);
    expect(winning(DOCKED_EDITOR_SLOT, "background-clip")).toBe("content-box");
    expect(winning(DOCKED_EDITOR_SLOT, "clip-path")).toBe(
      "inset(var(--agent-surface-header-height) 0 0 0)",
    );
  });

  it("lets the rail divider alone separate a maximized panel so no double rule appears", () => {
    expect(winning(MAXIMIZED_SURFACE, "box-shadow")).toBe("none");
    expect(winning(MAXIMIZED_SURFACE, "padding-left")).toBe("0");
  });

  it("runs the panel hairlines edge to edge from the start of the panel content", () => {
    for (const selector of [".cv-esub", ".cv-esub-notice", ".cv-rp-sub"]) {
      expect(winning(selector, "box-shadow"), selector).toBe("var(--cv-edge-bottom-hair)");
      for (const property of ["margin", "margin-left", "margin-right", "margin-inline"]) {
        expect(winning(selector, property), `${selector} ${property}`).toBeUndefined();
      }
    }
  });

  it("never places a chrome hairline with a transform, which skips device-pixel snapping", () => {
    const hairlines = parsed.rules.filter(
      (rule) =>
        CHROME_SHEETS.some((sheet) => rule.sheet.startsWith(sheet)) &&
        rule.declarations.some(
          (declaration) =>
            (declaration.property === "width" || declaration.property === "height") &&
            declaration.value === "1px",
        ),
    );
    const transformed = hairlines
      .filter((rule) =>
        rule.declarations.some(
          (declaration) =>
            declaration.property === "transform" || declaration.property === "translate",
        ),
      )
      .map((rule) => `${rule.sheet} ${rule.selector}`);

    expect(hairlines.length).toBeGreaterThan(0);
    expect(transformed).toEqual([]);
  });

  it("insets the split button seam by whole pixels instead of centring it", () => {
    expect(winning(".agent-split__chevron::before", "top")).toBe("7px");
    expect(winning(".agent-split__chevron::before", "bottom")).toBe("7px");
    expect(winning(".agent-split__chevron::before", "height")).toBeUndefined();
  });
});
