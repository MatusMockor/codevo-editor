import { describe, expect, it } from "vitest";
import { defaultAppSettings, normalizeAppSettings } from "./settings";
import {
  effectiveSpeechDictationLanguage,
  normalizeSpeechDictationLanguageSetting,
} from "./speechDictationLanguageSetting";

describe("speech dictation language setting", () => {
  it.each(["sk", "en", "cs"] as const)("keeps the stored language %s", (language) => {
    expect(normalizeSpeechDictationLanguageSetting(language)).toEqual({
      speechDictationLanguage: language,
    });
    expect(
      normalizeAppSettings({ speechDictationLanguage: language }).speechDictationLanguage,
    ).toBe(language);
  });
  it.each(["SK", "de", "", " sk", "sk-SK", null, undefined, 1, true, {}, ["sk"]])(
    "drops the unsupported stored value %j",
    (value) => {
      expect(normalizeSpeechDictationLanguageSetting(value)).toEqual({});
      const normalized = normalizeAppSettings({ speechDictationLanguage: value });
      expect(normalized.speechDictationLanguage).toBeUndefined();
      expect("speechDictationLanguage" in normalized).toBe(false);
    },
  );
  it("leaves the language unset by default so it follows the system locale", () => {
    expect("speechDictationLanguage" in defaultAppSettings()).toBe(false);
    expect("speechDictationLanguage" in normalizeAppSettings({})).toBe(false);
    expect("speechDictationLanguage" in normalizeAppSettings(null)).toBe(false);
  });
  it("round-trips a chosen language through serialization", () => {
    const stored = JSON.parse(
      JSON.stringify(normalizeAppSettings({ speechDictationLanguage: "cs" })),
    );
    expect(normalizeAppSettings(stored).speechDictationLanguage).toBe("cs");
  });
  it("does not disturb other settings when the stored language is malformed", () => {
    const normalized = normalizeAppSettings({
      agentFollowUpBehavior: "steer",
      speechDictationLanguage: "klingon",
    });
    expect(normalized.agentFollowUpBehavior).toBe("steer");
    expect(normalized.speechDictationLanguage).toBeUndefined();
  });
  it.each([
    ["sk", "en-US", "sk"],
    ["cs", "sk-SK", "cs"],
    ["en", "cs-CZ", "en"],
    [undefined, "sk-SK", "sk"],
    [undefined, "cs", "cs"],
    [undefined, "en-GB", "en"],
    [undefined, "de-DE", "en"],
    [undefined, "", "en"],
  ] as const)("resolves stored %j with locale %s to %s", (stored, locale, expected) => {
    expect(effectiveSpeechDictationLanguage(stored, locale)).toBe(expected);
  });
});
