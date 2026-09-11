import { describe, expect, it } from "vitest";
import {
  AGENT_MINIMAP_COLUMN_WIDTH,
  AGENT_MINIMAP_HIT_STRIP_MAX,
  AGENT_MINIMAP_PERSISTENT_GUTTER,
  AGENT_MINIMAP_RAIL_INSET,
  agentMinimapHasPersistentGutter,
  agentMinimapHitStripWidth,
  agentMinimapSideGutter,
} from "./agentMinimapPlacement";

const THRESHOLD = AGENT_MINIMAP_COLUMN_WIDTH + 2 * AGENT_MINIMAP_PERSISTENT_GUTTER;

describe("agent minimap placement", () => {
  it("measures the gutter as the air left of the centred reading column", () => {
    expect(agentMinimapSideGutter(1280)).toBe(256);
    expect(agentMinimapSideGutter(AGENT_MINIMAP_COLUMN_WIDTH)).toBe(0);
    expect(agentMinimapSideGutter(400)).toBe(0);
  });

  it("reads a missing or impossible width as no gutter at all", () => {
    expect(agentMinimapSideGutter(0)).toBe(0);
    expect(agentMinimapSideGutter(-320)).toBe(0);
    expect(agentMinimapSideGutter(Number.NaN)).toBe(0);
    expect(agentMinimapSideGutter(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("gates the rail on one threshold derived from the persistent gutter", () => {
    expect(THRESHOLD).toBe(864);
    expect(agentMinimapHasPersistentGutter(THRESHOLD - 1)).toBe(false);
    expect(agentMinimapHasPersistentGutter(THRESHOLD)).toBe(true);
    expect(agentMinimapHasPersistentGutter(THRESHOLD + 1)).toBe(true);
    expect(agentMinimapHasPersistentGutter(0)).toBe(false);
  });

  it("caps the hit strip to the gutter so it never reaches under the text", () => {
    for (const width of [700, 768, 800, 863, 864, 904, 1280, 2560]) {
      const gutter = agentMinimapSideGutter(width);
      const strip = agentMinimapHitStripWidth(width);
      expect(strip, `${width}px`).toBeLessThanOrEqual(AGENT_MINIMAP_HIT_STRIP_MAX);
      expect(strip, `${width}px`).toBeLessThanOrEqual(
        Math.max(0, gutter - AGENT_MINIMAP_RAIL_INSET),
      );
      expect(strip + AGENT_MINIMAP_RAIL_INSET, `${width}px`).toBeLessThanOrEqual(
        Math.max(AGENT_MINIMAP_RAIL_INSET, gutter),
      );
    }
  });

  it("gives the rail its full width once the gutter can hold it", () => {
    expect(agentMinimapHitStripWidth(THRESHOLD)).toBe(36);
    expect(agentMinimapHitStripWidth(1280)).toBe(AGENT_MINIMAP_HIT_STRIP_MAX);
  });

  it("goes inert instead of negative when the gutter is smaller than the inset", () => {
    expect(agentMinimapHitStripWidth(AGENT_MINIMAP_COLUMN_WIDTH)).toBe(0);
    expect(agentMinimapHitStripWidth(AGENT_MINIMAP_COLUMN_WIDTH + 24)).toBe(0);
    expect(agentMinimapHitStripWidth(0)).toBe(0);
    expect(agentMinimapHitStripWidth(Number.NaN)).toBe(0);
  });
});
