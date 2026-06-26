import { describe, expect, it } from "vitest";

import type { IntelligenceMode } from "./workspace";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  shouldUsePhpIntelligence,
} from "./intelligence";

const modes: IntelligenceMode[] = ["basic", "lightSmart", "fullSmart"];

describe("shouldUsePhpIntelligence", () => {
  it("disables PHP / Laravel navigation in basic (light) mode", () => {
    expect(shouldUsePhpIntelligence("basic")).toBe(false);
  });

  it("enables PHP / Laravel navigation in Smart Index mode", () => {
    expect(shouldUsePhpIntelligence("lightSmart")).toBe(true);
  });

  it("enables PHP / Laravel navigation in IDE mode", () => {
    expect(shouldUsePhpIntelligence("fullSmart")).toBe(true);
  });

  it("matches the workspace-index gate for every mode", () => {
    for (const mode of modes) {
      expect(shouldUsePhpIntelligence(mode)).toBe(shouldIndexWorkspace(mode));
    }
  });

  it("never enables PHP navigation without at least indexing the workspace", () => {
    for (const mode of modes) {
      if (!shouldIndexWorkspace(mode)) {
        expect(shouldUsePhpIntelligence(mode)).toBe(false);
      }
    }
  });

  it("keeps the language-server gate stricter than PHP navigation", () => {
    expect(shouldStartLanguageServer("lightSmart")).toBe(false);
    expect(shouldUsePhpIntelligence("lightSmart")).toBe(true);
  });
});
