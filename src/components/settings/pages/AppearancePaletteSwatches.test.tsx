// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PALETTE_IDS, type PaletteId, type ResolvedColorScheme } from "../../../domain/appearance";
import { paletteTokens, surfaceColor } from "../../../domain/appearancePalettes";
import { AppearancePaletteSwatches } from "./AppearancePaletteSwatches";

describe("AppearancePaletteSwatches", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    value: PaletteId,
    onChange: (palette: PaletteId) => void,
    scheme: ResolvedColorScheme = "dark",
  ): void {
    act(() =>
      root.render(<AppearancePaletteSwatches onChange={onChange} scheme={scheme} value={value} />),
    );
  }

  function cssBackground(color: string): string {
    const probe = document.createElement("span");
    probe.style.background = color;
    return probe.style.background;
  }

  function previewedTones(): readonly (readonly string[])[] {
    return swatches().map((swatch) => [
      swatch.style.background,
      swatch.querySelector<HTMLElement>(".settings-swatch__sidebar")?.style.background ?? "",
      swatch.querySelector<HTMLElement>(".settings-swatch__accent")?.style.background ?? "",
    ]);
  }

  function expectedTones(scheme: ResolvedColorScheme): readonly (readonly string[])[] {
    return PALETTE_IDS.map((palette) =>
      [
        surfaceColor(palette, scheme, "canvas"),
        surfaceColor(palette, scheme, "side"),
        paletteTokens(palette, scheme).accentFill,
      ].map(cssBackground),
    );
  }

  function swatches(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  }

  it("offers the six palettes as a labelled radiogroup with one tab stop", () => {
    render("ink-mint", () => undefined);

    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Palette");
    expect(swatches().map((swatch) => swatch.getAttribute("aria-label"))).toEqual([
      "Graphite · Teal",
      "Slate · Blue",
      "Black · Violet",
      "Ink · Mint",
      "Zinc · Orange",
      "Carbon · Lime",
    ]);
    expect(swatches().map((swatch) => swatch.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(swatches().filter((swatch) => swatch.tabIndex === 0)).toHaveLength(1);
  });

  it("selects a palette by click", () => {
    const onChange = vi.fn();
    render("graphite-teal", onChange);

    act(() => swatches()[4]?.click());

    expect(onChange).toHaveBeenCalledWith("zinc-orange");
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const onChange = vi.fn();
    render("graphite-teal", onChange);
    const press = (key: string): void => {
      act(() => {
        swatches()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      });
    };

    press("ArrowLeft");
    press("End");
    press("ArrowRight");

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      "carbon-lime",
      "carbon-lime",
      "slate-blue",
    ]);
  });

  it.each(["dark", "light"] as const)(
    "previews every palette in the resolved %s scheme",
    (scheme) => {
      render("graphite-teal", () => undefined, scheme);

      expect(previewedTones()).toEqual(expectedTones(scheme));
    },
  );

  it("repaints the previews when the resolved scheme flips", () => {
    render("graphite-teal", () => undefined, "dark");
    render("graphite-teal", () => undefined, "light");

    expect(previewedTones()).toEqual(expectedTones("light"));
    expect(previewedTones()).not.toEqual(expectedTones("dark"));
  });
});
