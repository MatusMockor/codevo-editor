import { describe, expect, it } from "vitest";
import { readStyleSheet } from "../cssContractTestSupport";

const RAIL_CSS = readStyleSheet("components/agentMode/agentRail.css").source;

function rule(selector: string): string {
  const start = RAIL_CSS.indexOf(`\n\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const bodyStart = RAIL_CSS.indexOf("{", start);
  const end = RAIL_CSS.indexOf("}", bodyStart);
  return RAIL_CSS.slice(bodyStart + 1, end);
}

describe("agent rail scope menu styles", () => {
  it("grows the popup to fit project names between the trigger width and the 400px cap", () => {
    const menu = rule(".agent-menu.agent-scope-menu__menu");
    expect(menu).toContain("min-width: 220px");
    expect(menu).toContain("max-width: min(400px, calc(100vw - 16px))");
    expect(menu).toContain("background: var(--agent-raised)");
    expect(rule(".agent-menu.agent-scope-menu__menu,\n.agent-menu.agent-row-menu")).toContain(
      "padding: 6px",
    );
  });

  it("keeps the row as the only hover and focus surface", () => {
    const row = rule(".agent-scope-menu__row");
    expect(row).toContain("position: relative");
    expect(row).toContain("border-radius: var(--agent-radius-sm)");
    const highlight = rule(".agent-scope-menu__row:hover,\n.agent-scope-menu__row:focus-within");
    expect(highlight).toContain("background: var(--agent-hover)");
    expect(highlight).not.toContain("box-shadow");
    expect(RAIL_CSS).not.toContain(
      ".agent-scope-menu__row:hover {\n  background: var(--codevo-hover)",
    );
  });

  it("separates keyboard focus from hover with a stronger tone and a ring on the row surface", () => {
    const focus = rule(".agent-scope-menu__row:has(> .agent-scope-menu__item:focus-visible)");
    expect(focus).toContain("background: var(--agent-fill)");
    expect(focus).toContain("box-shadow: var(--codevo-focus-ring)");
    expect(focus).not.toContain("background: var(--agent-hover)");
    expect(rule(".agent-scope-menu__menu .agent-scope-menu__item:focus-visible")).not.toContain(
      "box-shadow: var(",
    );
  });

  it("keeps the inner scope item transparent in every state", () => {
    const flat = rule(
      ".agent-scope-menu__menu .agent-scope-menu__item,\n.agent-scope-menu__menu .agent-scope-menu__item:hover:not(:disabled),\n.agent-scope-menu__menu .agent-scope-menu__item:focus-visible",
    );
    expect(flat).toContain("background: transparent");
    expect(flat).toContain("box-shadow: none");
    const item = rule(".agent-scope-menu__menu .agent-scope-menu__item");
    expect(item).toContain("min-height: calc(32px * var(--codevo-fs-scale))");
    expect(item).toContain("border-radius: var(--agent-radius-sm)");
    expect(item).toContain("gap: 8px");
    expect(item).toContain("font-size: var(--codevo-fs-meta)");
    expect(item).toContain("padding: 0 58px 0 8px");
  });

  it("marks the checked project by weight and colour instead of a fill", () => {
    const checked = rule('.agent-scope-menu__menu .agent-scope-menu__item[aria-checked="true"]');
    expect(checked).toContain("font-weight: 600");
    expect(checked).toContain("color: var(--agent-text-strong)");
    expect(checked).not.toContain("background");
    expect(rule(".agent-scope-menu__menu .agent-scope-menu__item:focus-visible")).toContain(
      "color: var(--agent-text-strong)",
    );
  });

  it("lets the label take the row and keeps the chips after it as 11px subtle text", () => {
    const label = rule(".agent-scope-menu__label");
    expect(label).toContain("flex: 1");
    expect(label).toContain("min-width: 0");
    const meta = rule(".agent-scope-menu__meta");
    expect(meta).toContain("flex: none");
    expect(meta).toContain("color: var(--agent-text-subtle)");
    expect(meta).toContain("font-size: var(--codevo-fs-label)");
    expect(rule(".agent-scope-menu__count + .agent-scope-menu__state::before")).toContain(
      'content: "\\00B7"',
    );
    expect(meta).not.toContain("opacity");
  });

  it("overlays the row actions in the reserved gutter without a transform or a stacking context", () => {
    const actions = rule(".agent-scope-menu__actions");
    expect(actions).toContain("position: absolute");
    expect(actions).toContain("right: 4px");
    expect(actions).toContain("opacity: 0");
    expect(actions).not.toContain("min-width");
    expect(actions).not.toContain("transform");
    expect(actions).not.toContain("z-index");
    expect(
      rule('.agent-scope-menu__row:has(.agent-scope-menu__gear[aria-expanded="true"])'),
    ).toContain("z-index: 3");
    const reveal = rule(
      '.agent-scope-menu__row:hover .agent-scope-menu__actions,\n.agent-scope-menu__row:focus-within .agent-scope-menu__actions,\n.agent-scope-menu__row:has(.agent-scope-menu__gear[aria-expanded="true"])\n  .agent-scope-menu__actions',
    );
    expect(reveal).toContain("opacity: 1");
    expect(RAIL_CSS).toContain(
      "@media (hover: none) {\n  .agent-scope-menu__actions {\n    opacity: 1;\n  }\n}",
    );
  });

  it("draws the search as an underlined field without a fill or a ring", () => {
    const search = rule(".agent-scope-menu__search");
    expect(search).toContain("height: calc(28px * var(--codevo-fs-scale))");
    expect(search).toContain("background: var(--agent-raised)");
    expect(search).toContain("color: var(--agent-text-muted)");
    expect(search).not.toContain("border");
    expect(search).not.toContain("box-shadow");
    const underline = rule(".agent-scope-menu__search::after");
    expect(underline).toContain("height: 1px");
    expect(underline).toContain("background: var(--agent-hairline)");
    expect(rule(".agent-scope-menu__search:focus-within::after")).toContain(
      "background: var(--agent-accent)",
    );
    expect(rule(".agent-scope-menu__search:focus-within")).not.toContain("box-shadow");
  });

  it("paints the sticky search band on the same surface token as the popup", () => {
    const surface = "background: var(--agent-raised)";
    expect(rule(".agent-menu.agent-scope-menu__menu")).toContain(surface);
    expect(rule(".agent-scope-menu__search")).toContain(surface);
    expect(rule(".agent-scope-menu__search")).toContain("z-index: 2");
  });

  it("rotates the scope chevron when the picker is open and adds no trigger ring", () => {
    expect(rule(".agent-scope-menu.agent-picker--open .agent-picker__chevron")).toContain(
      "transform: rotate(180deg)",
    );
    const triggerRules = [
      ...RAIL_CSS.matchAll(/([^{}]*\.agent-picker__trigger[^{}]*)\{([^}]*)\}/g),
    ];
    expect(triggerRules.length).toBeGreaterThan(0);
    expect(
      triggerRules
        .filter((match) => (match[2] ?? "").includes("box-shadow"))
        .map((match) => (match[1] ?? "").trim()),
    ).toEqual([]);
  });
});
