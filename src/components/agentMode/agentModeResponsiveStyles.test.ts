import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");
const shellCss = readFileSync(resolve(import.meta.dirname, "../../App.css"), "utf8");

function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, `Missing CSS marker ${marker}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  expect(bodyStart, `Missing CSS body for ${marker}`).toBeGreaterThan(start);

  let depth = 1;
  for (let index = bodyStart + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }

  throw new Error(`Unclosed CSS body for ${marker}`);
}

function rule(selector: string, source = appCss): string {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector ${selector}`).toBeGreaterThanOrEqual(0);
  return block(source.slice(start), selector);
}

describe("agent mode responsive layout contract", () => {
  it("keeps the composer in a real non-overlapping center layout row", () => {
    expect(rule(".agent-mode__center")).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(rule(".agent-composer")).not.toMatch(/position:\s*absolute/);
    expect(rule(".agent-composer")).toContain("max-height: min(44vh, 320px)");
    expect(rule(".agent-session__body")).not.toMatch(/padding:[^;]*148px/);
  });

  it("narrows the thread rail before adapting thread navigation", () => {
    const tablet = block(appCss, "@media (max-width: 1180px)");
    const narrow = block(appCss, "@media (max-width: 720px)");

    expect(rule('.agent-mode[data-rail="expanded"]', tablet)).toContain(
      "--agent-rail-track: 248px",
    );
    expect(rule(".agent-mode__grid")).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(0, 1fr)",
    );
    expect(appCss).not.toContain(".agent-info");
    expect(appCss).not.toContain("--agent-info-width");
    expect(rule(".agent-mode__grid", narrow)).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-mode__grid", narrow)).toContain(
      "grid-template-rows: minmax(112px, 28vh) minmax(0, 1fr)",
    );
  });

  it("collapses the file tree column when the surface reports no tree", () => {
    expect(rule('.workbench-frame[data-tree="hidden"]')).toContain(
      "--agent-surface-tree-width: 0px",
    );
    expect(rule(".agent-surface-tree")).toContain("width: var(--agent-surface-tree-width)");
    expect(rule(".agent-surface__editor-slot")).toContain("flex: 1 1 auto");
    expect(
      rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss),
    ).toContain("padding-left: var(--agent-surface-tree-width)");
  });

  it("pins the maximized frame rail column to the rail track instead of the notice text", () => {
    const maximizedFrame = rule(
      '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] {',
      shellCss,
    );
    expect(maximizedFrame).not.toContain("grid-template-columns: auto");
    expect(maximizedFrame).toContain("grid-template-columns: min-content minmax(0, 1fr)");

    const maximizedAgent = rule(
      '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] > [data-slot="agent"]',
      shellCss,
    );
    expect(maximizedAgent).toContain("width: var(--agent-rail-track)");
    expect(maximizedAgent).toContain("min-width: 0");
    expect(maximizedAgent).toContain("overflow: hidden");
  });

  it("composes the collapsed rail with the maximized panel through the rail track", () => {
    expect(rule(".agent-mode {")).toContain("--agent-rail-track: var(--agent-rail-width)");
    expect(rule('.agent-mode[data-rail="collapsed"]')).toContain(
      "--agent-rail-track: var(--agent-rail-collapsed-width)",
    );
    expect(rule('.agent-mode[data-right-panel="maximized"] .agent-mode__grid')).toContain(
      "grid-template-columns: var(--agent-rail-track)",
    );
  });

  it("keeps the ship panel bounded inside the session column", () => {
    expect(rule(".agent-ship__message")).toContain("max-height: 120px");
    expect(rule(".agent-ship__conflicts")).toContain("overflow-y: auto");
    expect(rule(".agent-files__row")).toContain("flex-wrap: wrap");
  });

  it("preserves the Code escape and wraps secondary toolbar controls", () => {
    const narrow = block(appCss, "@media (max-width: 720px)");

    expect(rule(".workbench-toolbar", narrow)).toContain("flex-wrap: wrap");
    expect(rule(".workbench-mode-switch", narrow)).toContain("position: sticky");
    expect(rule(".workbench-mode-switch", narrow)).toContain("left: 0");
    expect(rule(".toolbar-status", narrow)).toContain("display: none");
  });
});
