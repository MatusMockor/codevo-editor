import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appShellClassName } from "./appShellClassName";

describe("window chrome styles", () => {
  it("uses a pointer cursor on clickable chrome controls", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../App.css"), "utf8");

    expect(cssRule(css, ".window-menu-button")).toContain("cursor: pointer;");
    expect(cssRule(css, ".window-menu-item")).toContain("cursor: pointer;");
    expect(cssRule(css, ".window-control")).toContain("cursor: pointer;");
  });

  it("centers the macOS native traffic-light spacer within the title bar", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../App.css"), "utf8");

    expect(cssRule(css, ".window-native-control-space")).toContain("align-self: stretch;");
    expect(cssRule(css, ".window-chrome-action-spacer")).toContain("align-self: stretch;");
  });

  it("drops the app title row only for the macOS agent workbench", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../App.css"), "utf8");
    const macAgent = cssRule(css, ".app-shell--agent-mode.app-shell--mac");

    expect(css).toContain("--window-native-controls-inset: 0px;");
    expect(css).toContain("--window-native-controls-row: 0px;");
    expect(macAgent).toContain("--window-chrome-height: 0px;");
    expect(macAgent).toContain("--window-native-controls-inset: 78px;");
    expect(macAgent).toContain("--window-native-controls-row: 36px;");
    expect(macAgent).toContain("--toast-top: 60px;");
    const hiddenChrome = cssRule(css, ".app-shell--agent-mode.app-shell--mac > .window-chrome");
    expect(hiddenChrome).toContain("visibility: hidden;");
    expect(hiddenChrome).toContain("height: 0;");
    expect(hiddenChrome).not.toContain("display: none;");
  });

  it("reserves the traffic-light space in the rail, the header and the settings sidebar", () => {
    const railCss = readFileSync(resolve(import.meta.dirname, "agentMode/agentRail.css"), "utf8");
    const threadCss = readFileSync(
      resolve(import.meta.dirname, "agentMode/agentThread.css"),
      "utf8",
    );
    const settingsCss = readFileSync(resolve(import.meta.dirname, "settings/settings.css"), "utf8");

    expect(cssRule(railCss, ".agent-rail > .agent-rail__chrome")).toContain(
      "max(4px, var(--window-native-controls-inset, 0px))",
    );
    expect(cssRule(railCss, ".agent-mode__grid > .agent-rail__chrome")).toContain(
      "padding-top: var(--window-native-controls-row, 0px);",
    );
    expect(cssRule(threadCss, ".agent-thread-head").replace(/\s+/g, " ")).toContain(
      "padding-left: max( 18px, calc(var(--window-native-controls-inset, 0px) - var(--agent-rail-track, 0px)) );",
    );
    expect(cssRule(settingsCss, ".app-shell--agent-mode .settings-screen__sidebar")).toContain(
      "padding-top: calc(14px + var(--window-native-controls-row, 0px));",
    );
  });

  it("keeps the maximized surface header clear of the traffic lights", () => {
    const surfaceCss = readFileSync(
      resolve(import.meta.dirname, "agentMode/agentSurface.css"),
      "utf8",
    );
    const head = cssRule(
      surfaceCss,
      '.workbench-frame[data-right-panel="maximized"] .agent-surface__head',
    );

    expect(head.replace(/\s+/g, " ")).toContain(
      "padding-left: max( var(--agent-space-3), calc(var(--window-native-controls-inset, 0px) - var(--agent-rail-track, 0px)) );",
    );
  });

  it("stamps the platform on the shell so the macOS rules need no :has() probe", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../App.css"), "utf8");

    expect(appShellClassName(true, false, "mac")).toBe(
      "app-shell app-shell--agent-mode app-shell--mac",
    );
    expect(appShellClassName(true, false, "linux")).toBe("app-shell app-shell--agent-mode");
    expect(appShellClassName(false, true, "mac")).toBe(
      "app-shell app-shell--settings app-shell--mac",
    );
    expect(css).not.toContain(".app-shell--agent-mode:has(");
  });
});

function cssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{[^}]+\\}`));

  if (!match) {
    throw new Error(`CSS rule not found: ${selector}`);
  }

  return match[0];
}
