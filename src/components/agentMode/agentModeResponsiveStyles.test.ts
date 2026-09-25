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
    expect(rule(".agent-mode__center")).toContain("display: flex");
    expect(rule(".agent-mode__center")).toContain("flex-direction: column");
    const composerCss = readStyleSheet(
      "components/agentMode/composer/agentComposerFrame.css",
    ).source;
    expect(rule(".cv-composer-dock", composerCss)).not.toMatch(/position:\s*absolute/);
    expect(rule(".cv-composer-dock", composerCss)).toContain("flex: none");
    expect(rule(".agent-composer__textarea", composerCss)).toContain(
      "max-height: min(40vh, calc(420px * var(--codevo-fs-scale, 1)))",
    );
    expect(rule(".agent-session__body")).not.toMatch(/padding:[^;]*148px/);
  });

  it("keeps the composer launch row full while the center column can hold it", () => {
    const center = rule(".agent-mode__center {");
    expect(center).toContain("container-name: agent-center");
    expect(center).toContain("container-type: inline-size");

    const composerCss = readStyleSheet(
      "components/agentMode/composer/agentComposerFrame.css",
    ).source;
    expect(rule(".cv-composer__foot", composerCss)).not.toContain("flex-wrap: wrap");
    expect(rule(".cv-composer__controls", composerCss)).toContain("min-width: 0");
    expect(rule('.agent-composer__launch[data-presentation="compact"]')).toContain(
      "flex: 0 1 auto",
    );
    expect(COMPACT_COMPOSER_QUERY).toBe(`(max-width: ${COMPACT_COMPOSER_MAX_INLINE_SIZE}px)`);
    expect(COMPACT_COMPOSER_MAX_INLINE_SIZE).toBeLessThan(620);

    expect(rule(".cv-composer__slab", composerCss)).not.toContain("max-width");
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
    expect(rule(".agent-mode__grid > .agent-rail", stacked)).toContain("grid-row: 1");
  });

  it("reflows thread content inside the docked center column", () => {
    const conversationCss = readStyleSheet(
      "components/agentMode/conversation/conversation.css",
    ).source;
    expect(rule(".agent-session")).toContain("min-width: 0");
    expect(rule(".agent-session__scroll", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-session__scroll", conversationCss)).toContain("overflow-x: hidden");
    expect(rule(".agent-session__body", conversationCss)).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(rule(".agent-session__body", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-turn", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-answer", conversationCss)).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(rule(".agent-answer", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-turn__events", conversationCss)).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(rule(".agent-turn__events", conversationCss)).toContain("min-width: 0");
    expect(
      rule(
        ".agent-raw__lines",
        readStyleSheet("components/agentMode/conversation/agentProse.css").source,
      ),
    ).toContain("overflow: auto");

    expect(rule(".agent-prompt", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-prompt__body", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-prompt__bubble", conversationCss)).toContain("min-width: 0");
    expect(rule(".agent-prompt__bubble", conversationCss)).toContain("max-width: 80%");
    expect(rule(".agent-prompt__body", conversationCss)).toContain("word-break: break-word");
    expect(rule(".cv-turn-meta", conversationCss)).toContain("min-width: 0");
    expect(rule(".cv-turn-meta__agent", conversationCss)).toContain("text-overflow: ellipsis");
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

  it("keeps narrow and short media rules off the composer slab form", () => {
    const narrow = withoutComments(block(appCss, "@media (max-width: 720px)"));
    const short = withoutComments(block(appCss, "@media (max-width: 460px), (max-height: 540px)"));

    for (const media of [narrow, short]) {
      expect(media).not.toMatch(/\.agent-composer\s*[,{]/);
      expect(media).not.toMatch(/\.cv-composer__slab\b/);
      expect(media).not.toContain(".agent-composer__row");
      expect(media).not.toContain(".agent-composer__spacer");
      expect(media).not.toContain(".agent-composer__footer");
    }
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
    const rail = rule(".agent-mode__grid > .agent-rail");
    const placement = rule(
      ".agent-mode__grid > .agent-rail {",
      readStyleSheet("components/agentMode/agentRail.css").source,
    );
    const handle = rule(".agent-rail-resize {");

    expect(rail).toContain("grid-row: 1 / -1");
    expect(placement).toContain("grid-column: 1");
    expect(handle).toContain("grid-column: 1");
    expect(handle).toContain("grid-row: 1 / -1");
    expect(handle).toContain("justify-self: end");
  });

  it("drops the rail handle once the rail stacks above the thread", () => {
    const railCss = readStyleSheet("components/agentMode/agentRail.css").source;
    const narrowRail = block(railCss, "@media (max-width: 720px)");

    expect(rule(".agent-rail-resize", narrowRail)).toContain("display: none");
  });

  it("keeps the workbench row alive when the macOS agent chrome row is zero height", () => {
    const shell = rule(".app-shell {", rootCss);
    const macAgent = rule(".app-shell--agent-mode.app-shell--mac {", rootCss);
    const hiddenChrome = rule(".app-shell--agent-mode.app-shell--mac > .window-chrome", rootCss);

    expect(shell).toContain("grid-template-rows: var(--window-chrome-height) minmax(0, 1fr);");
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

    expect(center).toContain("container-name: agent-center");
    expect(center).toContain("container-type: inline-size");
    expect(rule(".agent-split__label", compactActions)).toContain("display: none");
    const narrowCrumb = block(appCss, "@container agent-center (max-width: 420px)");
    expect(rule(".cv-crumb__label,\n  .cv-crumb__sep", narrowCrumb)).toContain("display: none");
  });

  it("adapts the surface chooser and header from the surface inline size", () => {
    const surface = rule(".agent-surface {");
    const narrow = block(appCss, "@container agent-surface (max-width: 480px)");

    expect(surface).toContain("container-name: agent-surface");
    expect(surface).toContain("container-type: inline-size");
    expect(rule(".agent-surface-empty__cards")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".agent-surface-empty__inner")).toContain("max-width: 320px");
    expect(rule(".agent-surface-empty", narrow)).toContain("padding: 16px");
    expect(rule(".agent-surface__head .cv-topbar__title > .agent-iconbutton")).toContain(
      "flex: none",
    );
  });

  it("reserves the largest variant focus-ring spread inside the surface scrollport", () => {
    expect(rule(".workbench-frame {")).toContain("--agent-surface-focus-gutter: 4px");
    expect(rule(".app-shell {")).toContain("0 0 0 4px var(--codevo-primary)");
  });

  it("lets the Files tree fill its surface and never offsets the editor overlay by a tree", () => {
    expect(shellCss).not.toContain("--agent-surface-tree-width");
    expect(rule(".agent-surface-tree")).toContain("flex: 1 1 auto");
    const editor = rule('.workbench-frame[data-layout="agent"] > [data-slot="editor"]', shellCss);
    expect(editor).not.toContain("padding-left");
    expect(editor.replace(/\s+/g, " ")).toContain(
      "clip-path: inset(var(--agent-surface-header-height) 0 0 0)",
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
    expect(rule(".agent-mode__grid > .agent-rail", appCss)).toContain("grid-row: 1 / -1");
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
      rule('.workbench-frame[data-layout="editor-only"] > [data-slot="surface"]', shellCss),
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
    expect(editor).not.toContain("padding-left");
    expect(editor).toContain("grid-row: 1 / -1");
    expect(rule(".app-shell {", shellCss)).toContain(
      "--agent-surface-header-height: var(--cv-topbar-h)",
    );
    expect(allStyles().match(/--agent-surface-header-height:/g)).toHaveLength(1);
  });

  it("pins the maximized frame rail column to the rail track and moves the bottom panel under the surface", () => {
    const maximizedFrame = rule(
      '.workbench-frame[data-layout="agent"][data-right-panel="maximized"] {',
      shellCss,
    );
    expect(maximizedFrame).not.toContain("grid-template-columns: auto");
    expect(maximizedFrame.replace(/\s+/g, " ")).toContain(
      "grid-template-columns: var(--agent-rail-track) minmax(0, 1fr);",
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
    ).toContain("grid-column: 2;");
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
    ).toContain("grid-template-columns: var(--agent-rail-track) 0px");
    expect(
      rule('.workbench-frame[data-right-panel="maximized"] .agent-mode__center', shellCss),
    ).toContain("visibility: hidden");
    expect(
      rule('.workbench-frame[data-right-panel="maximized"] .agent-mode__center', shellCss),
    ).toContain("content-visibility: hidden");
    expect(rule(".agent-mode__center {")).not.toContain("content-visibility");
  });

  it("keeps the Git surface readable inside the narrow right panel", () => {
    const gitCss = readStyleSheet("components/agentMode/rightPanel/git/agentGit.css").source;
    expect(rule(".cv-git__body", gitCss)).toContain("overflow: auto");
    expect(rule(".cv-git-row__path", gitCss)).toContain("overflow-wrap: anywhere");
    expect(rule(".cv-git-row__path", gitCss)).toContain("min-width: 0");
    expect(rule(".cv-git-banner__files", gitCss)).toContain("overflow-wrap: anywhere");
    expect(rule(".agent-files__row")).toContain("flex-wrap: wrap");
  });

  it("preserves the Code escape and wraps secondary toolbar controls", () => {
    const narrow = block(appCss, "@media (max-width: 720px)");

    expect(rule(".workbench-toolbar", narrow)).toContain("flex-wrap: wrap");
    expect(rule(".workbench-mode-switch", narrow)).toContain("position: sticky");
    expect(rule(".workbench-mode-switch", narrow)).toContain("left: 0");
    expect(rule(".toolbar-status", narrow)).toContain("display: none");
  });

  it("collapses the sidebar to a zero track and never leaves an empty stacked row", () => {
    expect(rule('.workbench-frame[data-layout="agent"] {', shellCss)).toContain(
      "--agent-rail-collapsed-width: 0px",
    );
    const stacked = block(appCss, "@media (max-width: 720px)");
    expect(rule('.workbench-frame[data-rail="collapsed"] .agent-mode__grid', stacked)).toContain(
      "grid-template-rows: minmax(0, 1fr)",
    );
    expect(rule('.workbench-frame[data-rail="collapsed"] .agent-mode__center', stacked)).toContain(
      "grid-row: 1",
    );
  });
});
