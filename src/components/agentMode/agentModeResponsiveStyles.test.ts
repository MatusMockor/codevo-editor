import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readStyleSheet } from "../cssContractTestSupport";
import { AGENT_CENTER_MIN_WIDTH } from "../../domain/agentWorkbenchResponsiveLayout";
import { readAgentModeStyles } from "./agentModeCssTestSupport";
import {
  COMPACT_COMPOSER_MAX_INLINE_SIZE,
  COMPACT_COMPOSER_QUERY,
} from "./useCompactComposerControls";

const appCss = readAgentModeStyles();
const shellCss = readFileSync(resolve(import.meta.dirname, "../workbenchShellFrame.css"), "utf8");
const rootCss = readFileSync(resolve(import.meta.dirname, "../../App.css"), "utf8");

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

function allStyles(): string {
  const agentSheets = readdirSync(import.meta.dirname)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8"));
  const settingsCss = readFileSync(
    resolve(import.meta.dirname, "../settings/settings.css"),
    "utf8",
  );
  return [rootCss, shellCss, settingsCss, appCss, ...agentSheets].join("");
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
}

function depthAt(source: string, index: number): number {
  let depth = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") depth -= 1;
  }
  return depth;
}

function selectorStart(source: string, selector: string): number {
  const scan = withoutComments(source);
  const needle = selector.trim();
  const bare = needle.endsWith("{") ? needle.slice(0, -1).trim() : needle;
  const first = scan.indexOf(needle);
  let nested = -1;
  for (let index = first; index >= 0; index = scan.indexOf(needle, index + 1)) {
    const braceAt = scan.indexOf("{", index);
    if (braceAt < 0) break;
    const boundary = Math.max(
      scan.lastIndexOf("{", index),
      scan.lastIndexOf("}", index),
      scan.lastIndexOf(";", index),
    );
    const parts = scan
      .slice(boundary + 1, braceAt)
      .split(",")
      .map((part) => part.trim());
    if (!parts.includes(bare)) continue;
    if (depthAt(scan, index) === 0) return index;
    if (nested < 0) nested = index;
  }
  return nested >= 0 ? nested : first;
}

function rule(selector: string, source = appCss): string {
  const start = selectorStart(source, selector);
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

  it("keeps the composer launch row full while the center column can hold it", () => {
    const center = rule(".agent-mode__center {");
    expect(center).toContain("container-name: agent-center");
    expect(center).toContain("container-type: inline-size");

    expect(rule('.agent-composer__row[data-presentation="compact"]')).toContain(
      "flex-wrap: nowrap",
    );
    expect(rule('.agent-composer__launch[data-presentation="compact"]')).toContain(
      "flex: 0 1 auto",
    );
    expect(COMPACT_COMPOSER_QUERY).toBe(`(max-width: ${COMPACT_COMPOSER_MAX_INLINE_SIZE}px)`);
    expect(COMPACT_COMPOSER_MAX_INLINE_SIZE).toBeLessThan(620);

    expect(rule(".agent-composer__box")).toContain("max-width: 768px");
    expect(appCss).not.toContain("@container agent-composer");
    for (const boxQuery of ["@container agent-center (max-width: 900px)"]) {
      expect(block(appCss, boxQuery)).not.toContain(".agent-composer__launch");
    }
  });

  it("gives the stacked narrow grid the whole column instead of an implicit empty track", () => {
    const stacked = block(appCss, "@media (max-width: 720px)");

    expect(rule(".agent-mode__grid", stacked)).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-mode__center", stacked)).toContain("grid-column: 1");
    expect(rule(".agent-mode__center", stacked)).toContain("grid-row: 2");
    expect(
      rule(".agent-mode__grid > .agent-rail,\n  .agent-mode__grid > .agent-rail__chrome", stacked),
    ).toContain("grid-row: 1");
  });

  it("reflows thread content inside the docked center column", () => {
    expect(rule(".agent-session")).toContain("min-width: 0");
    expect(rule(".agent-session__scroll")).toContain("min-width: 0");
    expect(rule(".agent-session__scroll")).toContain("overflow-x: hidden");
    expect(rule(".agent-session__body")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-session__body")).toContain("min-width: 0");
    expect(rule(".agent-turn")).toContain("min-width: 0");
    expect(rule(".agent-answer")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-answer")).toContain("min-width: 0");
    expect(rule(".agent-turn__events")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-turn__events")).toContain("min-width: 0");
    expect(rule(".agent-raw__lines")).toContain("overflow: auto");

    const narrowCenter = block(appCss, "@container agent-center (max-width: 600px)");
    expect(rule(".agent-answer", narrowCenter)).toContain("padding-left: 0");
    expect(rule(".agent-band", narrowCenter)).toContain(
      "grid-template-columns: auto minmax(0, 1fr) auto auto",
    );
    expect(rule(".agent-band__meta")).toContain("opacity: 0");
    expect(rule(".agent-band__meta")).toContain("justify-content: flex-end");
    expect(rule(".agent-band:hover .agent-band__meta")).toContain("opacity: 1");
  });

  it("keeps the frame bounded and gives the thread column a real minimum track", () => {
    const frame = rule('.workbench-frame[data-layout="agent"] {', shellCss);
    expect(frame).toContain("overflow: hidden");
    expect(frame.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(var(--agent-center-min-width), 1fr) var(--agent-right-panel-width)",
    );
    expect(rule('.workbench-frame[data-layout="agent"] > [data-slot="agent"]', shellCss)).toContain(
      "overflow: hidden",
    );
  });

  it("paints every window root and shell with an opaque full-size background", () => {
    const roots = block(rootCss, "html,");
    const shell = rule(".app-shell {", rootCss);
    expect(roots).toContain("min-width: 100%");
    expect(roots).toContain("min-height: 100%");
    expect(roots).toContain("background: var(--color-app)");
    expect(shell).toContain("min-width: 100%");
    expect(shell).toContain("min-height: 100%");
    expect(shell).toContain("background: var(--color-app)");
  });

  it("narrows the thread rail before adapting thread navigation", () => {
    const tablet = block(shellCss, "@media (max-width: 1180px)");
    const shellNarrow = block(shellCss, "@media (max-width: 720px)");
    const narrow = block(appCss, "@media (max-width: 720px)");

    expect(rule('.workbench-frame[data-layout="agent"][data-rail="expanded"]', tablet)).toContain(
      "--agent-rail-track: min(var(--agent-rail-width), 248px)",
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

  it("pins the rail and its resize handle to the first frame track", () => {
    const rail = rule(".agent-mode__grid > .agent-rail,\n.agent-mode__grid > .agent-rail__chrome");
    const placement = rule(
      ".agent-mode__grid > .agent-rail,\n.agent-mode__grid > .agent-rail__chrome {",
      readStyleSheet("components/agentMode/agentRail.css").source,
    );
    const handle = rule(".agent-rail-resize {");

    expect(rail).toContain("grid-row: 1 / -1");
    expect(placement).toContain("grid-column: 1");
    expect(handle).toContain("grid-column: 1");
    expect(handle).toContain("grid-row: 1 / -1");
    expect(handle).toContain("justify-self: end");
  });

  it("drops the rail handle and the header inset once the rail stacks above the thread", () => {
    const railCss = readStyleSheet("components/agentMode/agentRail.css").source;
    const threadCss = readStyleSheet("components/agentMode/agentThread.css").source;
    const narrowRail = block(railCss, "@media (max-width: 720px)");
    const narrowThread = block(threadCss, "@media (max-width: 720px)");

    expect(rule(".agent-rail-resize", narrowRail)).toContain("display: none");
    expect(rule(".agent-thread-head", narrowThread)).toContain("padding-left: 8px");
  });

  it("keeps the workbench row alive when the macOS agent chrome row is zero height", () => {
    const shell = rule(".app-shell {", rootCss);
    const macAgent = rule(".app-shell--agent-mode.app-shell--mac {", rootCss);
    const hiddenChrome = rule(".app-shell--agent-mode.app-shell--mac > .window-chrome", rootCss);

    expect(shell).toContain("grid-template-rows: var(--window-chrome-height) minmax(0, 1fr) 28px");
    expect(macAgent).toContain("--window-chrome-height: 0px");
    expect(hiddenChrome).not.toContain("display: none");
    expect(hiddenChrome).toContain("visibility: hidden");
    expect(hiddenChrome).toContain("height: 0");
  });

  it("reserves a composer-sized centre track before the right panel takes width", () => {
    expect(rule('.workbench-frame[data-layout="agent"] {', shellCss)).toContain(
      "--agent-center-min-width: 560px",
    );
    expect(AGENT_CENTER_MIN_WIDTH).toBe(560);
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
    expect(rule(".agent-crumbs__heading")).toContain("text-overflow: ellipsis");
  });

  it("adapts the surface chooser and header from the surface inline size", () => {
    const surface = rule(".agent-surface {");
    const narrow = block(appCss, "@container agent-surface (max-width: 480px)");

    expect(surface).toContain("container-name: agent-surface");
    expect(surface).toContain("container-type: inline-size");
    expect(rule(".agent-surface-empty__cards")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-surface-empty__inner")).toContain("max-width: 320px");
    expect(rule(".agent-surface-empty", narrow)).toContain("padding: 16px");
    expect(rule(".agent-surface__tab > span", narrow)).not.toContain("clip-path");
    expect(rule(".agent-surface__tab > span", narrow)).not.toContain("width: 1px");
    expect(rule(".agent-surface__tab > span", narrow)).toContain("min-width: 3ch");
    expect(rule(".agent-surface__tabitem", narrow)).toContain("flex: 0 1 auto");
    expect(rule(".agent-surface__tabitem--active", narrow)).toContain("flex: 0 0 auto");
    expect(rule(".agent-surface__tabs", narrow)).toContain("overflow-x: auto");
    expect(rule(".agent-surface__tabs", narrow)).toContain(
      "padding: var(--agent-surface-focus-gutter)",
    );
    expect(rule(".agent-surface__tabs", narrow)).toContain("scroll-padding-inline");
    expect(rule(".agent-surface__tabs")).toContain("overflow: hidden");
    expect(rule(".agent-surface__layout-controls")).toContain("flex: none");
    expect(rule(".agent-surface__head > .agent-iconbutton")).toContain("flex: none");
  });

  it("reserves the largest variant focus-ring spread inside the surface scrollport", () => {
    expect(rule(".workbench-frame {")).toContain("--agent-surface-focus-gutter: 4px");
    expect(rule('.workbench-frame[data-agent-variant="studio"]')).toContain("0 0 0 4px");
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
    expect(
      rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss).replace(
        /\s+/g,
        " ",
      ),
    ).toContain(
      "clip-path: inset(var(--agent-surface-header-height) 0 0 var(--agent-surface-tree-width))",
    );
  });

  it("places the docked bottom panel under the thread column beside full-height side rails", () => {
    const frame = rule('.workbench-frame[data-layout="agent"] {', shellCss);
    expect(frame.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(var(--agent-center-min-width), 1fr) var(--agent-right-panel-width)",
    );
    expect(frame).toContain("grid-template-rows: minmax(0, 1fr) var(--agent-bottom-panel-height)");

    const agent = rule('.workbench-frame[data-layout="agent"] > [data-slot="agent"]', shellCss);
    expect(agent).toContain("grid-column: 1 / 3");
    expect(agent).toContain("grid-row: 1 / -1");

    const agentGrid = rule(".agent-mode__grid {", appCss);
    expect(agentGrid).toContain(
      "grid-template-rows: minmax(0, 1fr) var(--agent-bottom-panel-height)",
    );
    expect(
      rule(".agent-mode__grid > .agent-rail,\n.agent-mode__grid > .agent-rail__chrome", appCss),
    ).toContain("grid-row: 1 / -1");
    expect(rule(".agent-mode__center {", appCss)).toContain("grid-row: 1");

    const bottom = rule('.workbench-frame[data-layout="agent"] > [data-slot="bottom"]', shellCss);
    expect(bottom).toContain("grid-column: 2");
    expect(bottom).toContain("grid-row: 2");
    expect(bottom).toContain("z-index: 1");

    const surface = rule('.workbench-frame[data-layout="agent"] > [data-slot="surface"]', shellCss);
    expect(surface).toContain("grid-column: 3");
    expect(surface).toContain("grid-row: 1 / -1");
    expect(
      rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss),
    ).toContain("grid-column: 3");
    expect(
      rule(
        '.workbench-frame > [data-slot="surface"][hidden],\n.workbench-frame > [data-slot="editor"][hidden]',
        shellCss,
      ),
    ).toContain("display: none");
  });

  it("places the agent slots as direct frame children and hides them only through the settings surface", () => {
    expect(shellCss).not.toContain("workbench-frame__agent");
    expect(shellCss.match(/display: contents/g)).toHaveLength(1);
    expect(rule(".workbench-frame__chrome {", shellCss)).toContain("display: contents");

    const surface = rule('.workbench-frame[data-layout="agent"] > [data-slot="surface"]', shellCss);
    expect(surface).toContain("grid-column: 3");
    expect(surface).toContain("grid-row: 1 / -1");
    expect(
      rule(
        '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] > [data-slot="surface"]',
        shellCss,
      ),
    ).toContain("grid-column: 2");
    expect(
      rule('.workbench-frame[data-layout="editor-expanded"] > [data-slot="surface"]', shellCss),
    ).toContain("display: none");

    expect(rule('.workbench-frame[data-surface="settings"] {', shellCss)).toContain(
      "display: flex",
    );
    expect(
      rule('.workbench-frame[data-surface="settings"] > *:not([data-slot="settings"])', shellCss),
    ).toContain("display: none");
  });

  it("offsets the editor overlay by the same header token that sizes the surface head", () => {
    const editor = rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss);
    expect(editor).toContain("padding-top: var(--agent-surface-header-height)");
    expect(editor).toContain("padding-left: var(--agent-surface-tree-width)");
    expect(editor).toContain("grid-row: 1 / -1");
    expect(rule(".agent-surface__head")).toContain("height: var(--agent-surface-header-height)");
    expect(rule(".app-shell {", shellCss)).toContain("--agent-surface-header-height: 40px");
    expect(allStyles().match(/--agent-surface-header-height:/g)).toHaveLength(1);
  });

  it("pins the maximized frame rail column to the rail track and moves the bottom panel under the surface", () => {
    const maximizedFrame = rule(
      '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] {',
      shellCss,
    );
    expect(maximizedFrame).not.toContain("grid-template-columns: auto");
    expect(maximizedFrame.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(0, 1fr) var(--agent-surface-tree-width)",
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
    ).toContain("grid-column: 2 / 4");
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
