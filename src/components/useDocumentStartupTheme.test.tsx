// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppTheme } from "../domain/settings";
import { STARTUP_THEME_ATTRIBUTE } from "../domain/startupTheme";
import { useAppWorkbenchThemes } from "./useAppWorkbenchThemes";

let host: HTMLElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
  document.documentElement.removeAttribute(STARTUP_THEME_ATTRIBUTE);
});

function Probe({
  prefersLight,
  theme,
}: {
  readonly prefersLight: boolean;
  readonly theme: AppTheme;
}) {
  useAppWorkbenchThemes(theme, prefersLight);
  return null;
}

function mount(theme: AppTheme, prefersLight: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  const root = createRoot(container);
  const render = (nextTheme: AppTheme, nextPrefersLight: boolean) => {
    act(() => {
      root.render(<Probe prefersLight={nextPrefersLight} theme={nextTheme} />);
    });
  };
  render(theme, prefersLight);
  return render;
}

function stamped(): string | null {
  return document.documentElement.getAttribute(STARTUP_THEME_ATTRIBUTE);
}

describe("document startup theme", () => {
  it("mirrors the live theme onto the document element", () => {
    mount("dracula", false);

    expect(stamped()).toBe("dracula");
  });

  it("keeps a stale boot value from outliving a runtime theme change", () => {
    document.documentElement.setAttribute(STARTUP_THEME_ATTRIBUTE, "dark");
    const render = mount("dark", false);
    expect(stamped()).toBe("dark");

    render("catppuccinLatte", false);

    expect(stamped()).toBe("catppuccinLatte");
  });

  it("resolves the system theme against the reported colour scheme", () => {
    const render = mount("system", true);
    expect(stamped()).toBe("light");

    render("system", false);

    expect(stamped()).toBe("dark");
  });
});
