import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");
const shellCss = readFileSync(resolve(import.meta.dirname, "../workbenchShellFrame.css"), "utf8");

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
    const tablet = block(shellCss, "@media (max-width: 1180px)");
    const shellNarrow = block(shellCss, "@media (max-width: 720px)");
    const narrow = block(appCss, "@media (max-width: 720px)");

    expect(rule('.workbench-frame[data-layout="agent"][data-rail="expanded"]', tablet)).toContain(
      "--agent-rail-track: 248px",
    );
    expect(
      rule('.workbench-frame[data-layout="agent"][data-right-panel="docked"]', shellNarrow),
    ).toContain("--agent-rail-track: 0px");
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

  it("collapses header action labels from the center column before wrapping the header", () => {
    const center = rule(".agent-mode__center");
    const compactActions = block(appCss, "@container agent-center (max-width: 900px)");
    const narrowHeader = block(appCss, "@container agent-center (max-width: 600px)");

    expect(center).toContain("container-name: agent-center");
    expect(center).toContain("container-type: inline-size");
    expect(rule(".agent-split__label", compactActions)).toContain("display: none");
    expect(rule(".agent-thread-head", narrowHeader)).toContain("padding-inline: 8px");
    expect(rule(".agent-thread-head__actions", narrowHeader)).not.toContain("flex-wrap");
    expect(rule(".agent-thread-head__status-label", narrowHeader)).toContain("display: none");
    expect(rule(".agent-crumbs__heading")).toContain("text-overflow: ellipsis");
  });

  it("adapts the surface chooser and header from the surface inline size", () => {
    const surface = rule(".agent-surface {");
    const narrow = block(appCss, "@container agent-surface (max-width: 480px)");

    expect(surface).toContain("container-name: agent-surface");
    expect(surface).toContain("container-type: inline-size");
    expect(rule(".agent-surface-empty__cards", narrow)).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(rule(".agent-surface__tab > span", narrow)).toContain("clip-path: inset(50%)");
    expect(rule(".agent-surface__tabs", narrow)).toContain("overflow-x: auto");
    expect(rule(".agent-surface__tabs")).toContain("overflow: hidden");
    expect(rule(".agent-surface__layout-controls")).toContain("flex: none");
    expect(rule(".agent-surface__head > .agent-iconbutton")).toContain("flex: none");
  });

  it("collapses the file tree column when the surface reports no tree", () => {
    expect(rule('.workbench-frame[data-tree="hidden"]', shellCss)).toContain(
      "--agent-surface-tree-width: 0px",
    );
    expect(rule(".agent-surface-tree")).toContain("width: var(--agent-surface-tree-width)");
    expect(rule(".agent-surface__editor-slot")).toContain("flex: 1 1 auto");
    expect(
      rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss),
    ).toContain("padding-left: var(--agent-surface-tree-width)");
  });

  it("places the docked bottom panel under the thread column beside a full-height right panel", () => {
    const frame = rule('.workbench-frame[data-layout="agent"] {', shellCss);
    expect(frame.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(0, 1fr) var(--agent-right-panel-width)",
    );
    expect(frame).toContain("grid-template-rows: minmax(0, 1fr) var(--agent-bottom-panel-height)");

    const agent = rule('.workbench-frame[data-layout="agent"] > [data-slot="agent"]', shellCss);
    expect(agent).toContain("grid-column: 1 / 3");
    expect(agent).toContain("grid-row: 1");

    const bottom = rule('.workbench-frame[data-layout="agent"] > [data-slot="bottom"]', shellCss);
    expect(bottom).toContain("grid-column: 2");
    expect(bottom).toContain("grid-row: 2");

    const surface = rule('.workbench-frame[data-layout="agent"] > [data-slot="surface"]', shellCss);
    expect(surface).toContain("grid-column: 3");
    expect(surface).toContain("grid-row: 1 / -1");
    expect(
      rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss),
    ).toContain("grid-column: 3");
  });

  it("pins the maximized frame rail column to the rail track and moves the bottom panel under the surface", () => {
    const maximizedFrame = rule(
      '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] {',
      shellCss,
    );
    expect(maximizedFrame).not.toContain("grid-template-columns: auto");
    expect(maximizedFrame).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(0, 1fr)",
    );

    const maximizedAgent = rule(
      '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] > [data-slot="agent"]',
      shellCss,
    );
    expect(maximizedAgent).toContain("grid-column: 1");
    expect(maximizedAgent).toContain("overflow: hidden");
    expect(
      rule(
        '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] > [data-slot="bottom"]',
        shellCss,
      ),
    ).toContain("grid-column: 2");
  });

  it("composes the collapsed rail with the maximized panel through the frame-owned rail track", () => {
    expect(appCss).not.toContain("--agent-rail-track:");
    expect(appCss).not.toContain("--agent-rail-width:");
    expect(appCss).not.toContain(".agent-mode[data-right-panel=");
    expect(rule('.workbench-frame[data-layout="agent"] {', shellCss)).toContain(
      "--agent-rail-track: var(--agent-rail-width)",
    );
    expect(
      rule('.workbench-frame[data-layout="agent"][data-rail="collapsed"]', shellCss),
    ).toContain("--agent-rail-track: var(--agent-rail-collapsed-width)");
    expect(
      rule('.workbench-frame[data-right-panel="maximized"] .agent-mode__grid', shellCss),
    ).toContain("grid-template-columns: var(--agent-rail-track)");
    expect(
      rule('.workbench-frame[data-right-panel="maximized"] .agent-mode__center', shellCss),
    ).toContain("display: none");
  });

  it("keeps the ship panel bounded inside the session column", () => {
    expect(rule(".agent-popover--ship")).toContain("max-width: calc(100% - 16px)");
    expect(rule(".agent-popover--ship")).not.toContain("100vw");
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
