import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  generateLargeTsFileContent,
  LARGE_FILE_SPECS,
} from "./fixtureGenerator.mjs";
import {
  LSP_TRACKER_FIXTURE_FILE,
  POLICY_DISABLED_FIXTURE_FILE,
  POLICY_DISABLED_REASON,
} from "./perfScenarios.mjs";
import {
  MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS,
  classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics,
} from "../../src/domain/javaScriptTypeScriptLargeDocumentCapability";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocumentContent,
} from "../../src/domain/largeDocumentPolicy";

function fixtureContent(name) {
  const spec = LARGE_FILE_SPECS.find((entry) => entry.name === name);
  expect(spec).toBeDefined();

  return generateLargeTsFileContent({ lines: spec.lines, random: createSeededRandom(spec.seed) });
}

function metrics(content) {
  return { lineCount: content.split("\n").length, characters: content.length };
}

describe("LSP tracker fixture versus the large-document policy", () => {
  it("keeps the measured fixture strictly inside both policy limits", () => {
    const { lineCount, characters } = metrics(fixtureContent(LSP_TRACKER_FIXTURE_FILE));

    expect(lineCount).toBeLessThan(defaultLargeSmartDocumentPolicy.lineLimit);
    expect(characters).toBeLessThan(defaultLargeSmartDocumentPolicy.characterLimit);
  });

  it("proves JS/TS features really are enabled on the measured fixture", () => {
    const content = fixtureContent(LSP_TRACKER_FIXTURE_FILE);

    expect(isLargeSmartDocumentContent(content, defaultLargeSmartDocumentPolicy)).toBe(false);
  });

  it("proves the policy-disabled capability row is true for the large fixture", () => {
    const content = fixtureContent(POLICY_DISABLED_FIXTURE_FILE);
    const { lineCount, characters } = metrics(content);

    expect(isLargeSmartDocumentContent(content, defaultLargeSmartDocumentPolicy)).toBe(true);
    expect(lineCount).toBeGreaterThan(defaultLargeSmartDocumentPolicy.lineLimit);
    expect(characters).toBeGreaterThan(defaultLargeSmartDocumentPolicy.characterLimit);
  });

  it("proves the 100k fixture is editing-only at the hard UTF-16 sync boundary", () => {
    const content = fixtureContent(POLICY_DISABLED_FIXTURE_FILE);
    const observation = classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics({
      lineCount: content.split("\n").length,
      utf16Length: content.length,
    });

    expect(content.length).toBeGreaterThan(MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS);
    expect(observation).toEqual({ kind: "editing-only", reason: "full-sync-utf16-limit" });
    expect(POLICY_DISABLED_REASON).toContain("editing-only");
    expect(POLICY_DISABLED_REASON).toContain("full-sync-utf16-limit");
  });
});
