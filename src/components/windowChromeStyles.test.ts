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
    expect(cssRule(css, ".window-native-control-space")).toContain(
      "width: var(--cv-traffic-light-inset);",
    );
  });

  it("drops the app title row only for the macOS agent workbench", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../App.css"), "utf8");
    const macAgent = cssRule(css, ".app-shell--agent-mode.app-shell--mac");

    expect(css).toContain("--window-native-controls-inset: 0px;");
    expect(css).toContain("--window-native-controls-row: 0px;");
    expect(macAgent).toContain("--window-chrome-height: 0px;");
    expect(macAgent).toContain("--window-native-controls-inset: var(--cv-traffic-light-inset);");
    expect(macAgent).toContain("--window-native-controls-row: 36px;");
    expect(macAgent).toContain("--toast-top: 60px;");
    const hiddenChrome = cssRule(css, ".app-shell--agent-mode.app-shell--mac > .window-chrome");
    expect(hiddenChrome).toContain("visibility: hidden;");
    expect(hiddenChrome).toContain("height: 0;");
    expect(hiddenChrome).not.toContain("display: none;");
  });

  it("keeps the traffic lights inside the settings nav top bar", () => {
    const appCss = readFileSync(resolve(import.meta.dirname, "../App.css"), "utf8");
    const semanticCss = readFileSync(
      resolve(import.meta.dirname, "../ui/tokens/semantic.css"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(import.meta.dirname, "settings/SettingsSectionSidebar.tsx"),
      "utf8",
    );
    const nativeRow = /--window-native-controls-row: (\d+)px;/.exec(
      cssRule(appCss, ".app-shell--agent-mode.app-shell--mac"),
    );
    const topBarHeight = /--cv-topbar-h: (\d+)px;/.exec(semanticCss);

    expect(sidebar).toMatch(/className="settings-nav-column">\s*<TopBar [^>]*region="sidebar"/);
    expect(Number(topBarHeight?.[1])).toBeGreaterThanOrEqual(Number(nativeRow?.[1]));
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
