import { describe, expect, it } from "vitest";
import { PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "./appearance";
import { surfaceColor } from "./appearancePalettes";
import { nativeWindowBackground } from "./nativeWindowBackground";

describe("nativeWindowBackground", () => {
  it("paints the native window with the side tone of every palette and scheme", () => {
    for (const palette of PALETTE_IDS) {
      for (const colorScheme of RESOLVED_COLOR_SCHEMES) {
        expect(nativeWindowBackground({ palette, colorScheme }), `${palette} ${colorScheme}`).toBe(
          surfaceColor(palette, colorScheme, "side"),
        );
      }
    }
  });

  it("uses a light tone for a light palette so a cold start cannot flash dark", () => {
    expect(nativeWindowBackground({ palette: "graphite-teal", colorScheme: "light" })).toBe(
      "#EDEEEF",
    );
    expect(nativeWindowBackground({ palette: "graphite-teal", colorScheme: "dark" })).toBe(
      "#151616",
    );
  });
});
