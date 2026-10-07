import { describe, expect, it } from "vitest";
import type { AgentAccountUsageWindow } from "./agentAccountUsage";
import {
  composerUsageDismissalKey,
  normalizeComposerUsageDismissalKey,
} from "./composerUsageDismissal";

const OBSERVED = Date.UTC(2026, 9, 6, 12);
const RESET = Date.UTC(2026, 9, 6, 13, 39);

function window(overrides: Partial<AgentAccountUsageWindow> = {}): AgentAccountUsageWindow {
  return {
    id: "five_hour",
    label: "5-hour limit",
    usedPercent: 100,
    windowDurationMinutes: 300,
    resetsAtEpochMs: RESET,
    resetsLabel: null,
    ...overrides,
  };
}

describe("composerUsageDismissalKey", () => {
  it("uses one identity for a Claude /usage label and a live reset with seconds", () => {
    const polled = window({ resetsAtEpochMs: null, resetsLabel: "1:39pm (UTC)" });
    const live = window({ resetsAtEpochMs: RESET + 27_000 });
    expect(composerUsageDismissalKey("claudeCode", polled, OBSERVED)).toBe(
      composerUsageDismissalKey("claudeCode", live, OBSERVED),
    );
  });

  it("uses one identity for comma and at separators and live resets", () => {
    const comma = window({ resetsAtEpochMs: null, resetsLabel: "Oct 6, 1:39pm (UTC)" });
    const at = window({ resetsAtEpochMs: null, resetsLabel: "Oct 6 at 1:39pm (UTC)" });
    const live = window({ resetsAtEpochMs: RESET + 27_000 });
    const key = composerUsageDismissalKey("claudeCode", live, OBSERVED);
    expect(composerUsageDismissalKey("claudeCode", comma, OBSERVED)).toBe(key);
    expect(composerUsageDismissalKey("claudeCode", at, OBSERVED)).toBe(key);
  });

  it("keeps different reset minutes and providers distinct", () => {
    const key = composerUsageDismissalKey("claudeCode", window(), OBSERVED);
    expect(
      composerUsageDismissalKey(
        "claudeCode",
        window({ resetsAtEpochMs: RESET + 60_000 }),
        OBSERVED,
      ),
    ).not.toBe(key);
    expect(composerUsageDismissalKey("codex", window(), OBSERVED)).not.toBe(key);
    expect(
      composerUsageDismissalKey("codex", window({ resetsAtEpochMs: RESET + 27_000 }), OBSERVED),
    ).not.toBe(composerUsageDismissalKey("codex", window(), OBSERVED));
  });
});

describe("normalizeComposerUsageDismissalKey", () => {
  it("normalizes earlier Claude identities without changing Codex identities", () => {
    const oldClaude = JSON.stringify(["claudeCode", "five_hour", `at:${RESET + 27_000}`]);
    expect(normalizeComposerUsageDismissalKey(oldClaude)).toBe(
      composerUsageDismissalKey("claudeCode", window(), OBSERVED),
    );
    const codex = JSON.stringify(["codex", "five_hour", `at:${RESET + 27_000}`]);
    expect(normalizeComposerUsageDismissalKey(codex)).toBe(codex);
  });

  it("leaves malformed and unsupported keys alone", () => {
    for (const key of [
      "broken",
      "null",
      "{}",
      JSON.stringify(["claudeCode", "five_hour", "label:unknown"]),
      JSON.stringify(["claudeCode", "five_hour", "at:9007199254740992"]),
      JSON.stringify(["unknown", "five_hour", `at:${RESET}`]),
      JSON.stringify(["claudeCode", "five_hour", `at:${RESET}`, "extra"]),
    ]) {
      expect(normalizeComposerUsageDismissalKey(key)).toBe(key);
    }
  });
});
