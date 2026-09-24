// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLOR_SCHEME_ATTRIBUTE,
  PALETTE_ATTRIBUTE,
  type AppearanceSettings,
} from "../domain/appearance";
import { useAppWorkbenchThemes, type AppWorkbenchThemes } from "./useAppWorkbenchThemes";

let host: HTMLElement | null = null;
let latest: AppWorkbenchThemes | null = null;

afterEach(() => {
  host?.remove();
  host = null;
  latest = null;
  document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  document.documentElement.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
});

function Probe({
  appearance,
  prefersLight,
}: {
  readonly appearance: AppearanceSettings;
  readonly prefersLight: boolean;
}) {
  latest = useAppWorkbenchThemes(appearance, prefersLight);
  return null;
}

function mount(appearance: AppearanceSettings, prefersLight: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  const root = createRoot(container);
  const render = (nextAppearance: AppearanceSettings, nextPrefersLight: boolean) => {
    act(() => {
      root.render(<Probe appearance={nextAppearance} prefersLight={nextPrefersLight} />);
    });
  };
  render(appearance, prefersLight);
  return render;
}

function stamped() {
  return {
    palette: document.documentElement.getAttribute(PALETTE_ATTRIBUTE),
    scheme: document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE),
  };
}

describe("useAppWorkbenchThemes", () => {
  it("stamps the palette and the resolved scheme on the document element", () => {
    mount({ palette: "zinc-orange", colorScheme: "light", syntaxTheme: "matchPalette" }, false);

    expect(stamped()).toEqual({ palette: "zinc-orange", scheme: "light" });
    expect(latest?.colorScheme).toBe("light");
    expect(latest?.monacoTheme).toBe("cv-zinc-orange-light");
  });

  it("follows a live system scheme flip without a settings change", () => {
    const system = {
      palette: "slate-blue",
      colorScheme: "system",
      syntaxTheme: "matchPalette",
    } as const;
    const render = mount(system, false);
    expect(stamped().scheme).toBe("dark");
    expect(latest?.monacoTheme).toBe("cv-slate-blue-dark");

    render(system, true);

    expect(stamped().scheme).toBe("light");
    expect(latest?.monacoTheme).toBe("cv-slate-blue-light");
  });

  it("replaces a stale boot palette and keeps a classic syntax theme", () => {
    document.documentElement.setAttribute(PALETTE_ATTRIBUTE, "graphite-teal");
    const render = mount(
      { palette: "graphite-teal", colorScheme: "dark", syntaxTheme: "matchPalette" },
      false,
    );

    render({ palette: "carbon-lime", colorScheme: "dark", syntaxTheme: "dracula" }, false);

    expect(stamped().palette).toBe("carbon-lime");
    expect(latest?.monacoTheme).toBe("dracula");
  });
});
