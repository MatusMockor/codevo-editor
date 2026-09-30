import { describe, expect, it } from "vitest";
import {
  EMPTY_MODEL_FIRST_SEEN_LEDGER,
  MAX_MODEL_FIRST_SEEN_ENTRIES,
  findModelFirstSeen,
  isModelReleaseDate,
  modelIsNew,
  observeModelCatalogs,
  parseModelFirstSeenLedger,
  type ModelFirstSeenLedger,
} from "./modelNewness";
import type { AgentCliKind } from "./agentTask";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");

function observeLiveModelCatalog(
  ledger: ModelFirstSeenLedger,
  provider: AgentCliKind,
  modelIds: ReadonlyArray<string>,
  nowMs: number,
): ModelFirstSeenLedger {
  return observeModelCatalogs(ledger, [{ provider, modelIds, live: true }], nowMs);
}

function firstSeen(ledger: ModelFirstSeenLedger, modelId: string) {
  return findModelFirstSeen(ledger, "codex", modelId);
}

describe("model release date newness", () => {
  it("shows NEW for a model released within the last 14 days", () => {
    expect(modelIsNew({ releaseDate: "2026-09-29" }, NOW)).toBe(true);
    expect(modelIsNew({ releaseDate: "2026-09-17" }, NOW)).toBe(true);
  });

  it("hides NEW once the release date is 14 or more days old", () => {
    expect(modelIsNew({ releaseDate: "2026-09-16" }, NOW)).toBe(false);
    expect(modelIsNew({ releaseDate: "2026-09-01" }, NOW)).toBe(false);
  });

  it("marks only the newer of two models when only it is inside the window", () => {
    const older = { releaseDate: "2026-07-24" };
    const newer = { releaseDate: "2026-09-22" };
    expect([modelIsNew(older, NOW), modelIsNew(newer, NOW)]).toEqual([false, true]);
  });

  it("trusts the live catalog flag unless the bundled release date shows it is stale", () => {
    expect(modelIsNew({ catalogFlag: false, releaseDate: "2026-09-29" }, NOW)).toBe(false);
    expect(modelIsNew({ catalogFlag: true }, NOW)).toBe(true);
    expect(modelIsNew({ catalogFlag: true, releaseDate: "2026-09-22" }, NOW)).toBe(true);
    expect(modelIsNew({ catalogFlag: true, releaseDate: "2026-09-01" }, NOW)).toBe(false);
  });

  it("does not treat a far-future release date as new", () => {
    expect(modelIsNew({ releaseDate: "2027-09-30" }, NOW)).toBe(false);
  });

  it("accepts only real calendar dates", () => {
    expect(isModelReleaseDate("2024-02-29")).toBe(true);
    for (const value of [
      "1999-01-01",
      "2026-02-30",
      "2026-9-01",
      "2026-09-01T00:00:00Z",
      "",
      20260901,
      null,
    ]) {
      expect(isModelReleaseDate(value)).toBe(false);
    }
  });
});

describe("model first-seen ledger", () => {
  it("records the first live catalog as the baseline, so nothing is NEW on the first run", () => {
    const ledger = observeLiveModelCatalog(
      EMPTY_MODEL_FIRST_SEEN_LEDGER,
      "codex",
      ["gpt-a", "gpt-b"],
      NOW,
    );
    expect(ledger.baselineProviders).toEqual(["codex"]);
    for (const id of ["gpt-a", "gpt-b"]) {
      expect(firstSeen(ledger, id)?.origin).toBe("baseline");
      expect(modelIsNew({ firstSeen: firstSeen(ledger, id) }, NOW)).toBe(false);
    }
  });

  it("shows NEW for 14 days after a model first appears after the baseline", () => {
    const baseline = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["a"], NOW);
    const ledger = observeLiveModelCatalog(baseline, "codex", ["a", "b"], NOW + DAY_MS);
    const entry = firstSeen(ledger, "b");
    expect(entry).toMatchObject({ origin: "discovered", firstSeenAtMs: NOW + DAY_MS });
    expect(modelIsNew({ firstSeen: entry }, NOW + DAY_MS)).toBe(true);
    expect(modelIsNew({ firstSeen: entry }, NOW + 14 * DAY_MS)).toBe(true);
    expect(modelIsNew({ firstSeen: entry }, NOW + 15 * DAY_MS)).toBe(false);
  });

  it("keeps the first sighting when the model is seen again", () => {
    const baseline = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["a"], NOW);
    const seen = observeLiveModelCatalog(baseline, "codex", ["a", "b"], NOW + DAY_MS);
    expect(observeLiveModelCatalog(seen, "codex", ["a", "b"], NOW + 5 * DAY_MS)).toBe(seen);
  });

  it("baselines each provider separately", () => {
    const codex = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["a"], NOW);
    const both = observeLiveModelCatalog(codex, "claudeCode", ["claude-x"], NOW + DAY_MS);
    expect(findModelFirstSeen(both, "claudeCode", "claude-x")?.origin).toBe("baseline");
    expect(findModelFirstSeen(both, "codex", "claude-x")).toBeUndefined();
  });

  it("prefers a release date over the first-seen record", () => {
    const baseline = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["a"], NOW);
    const ledger = observeLiveModelCatalog(baseline, "codex", ["a", "b"], NOW);
    expect(modelIsNew({ releaseDate: "2025-01-01", firstSeen: firstSeen(ledger, "b") }, NOW)).toBe(
      false,
    );
  });

  it("stays bounded and evicts the oldest records not in the observed catalog first", () => {
    const ids = Array.from({ length: MAX_MODEL_FIRST_SEEN_ENTRIES }, (_, index) => `m-${index}`);
    let ledger = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["kept"], NOW);
    ids.forEach((id, index) => {
      ledger = observeLiveModelCatalog(ledger, "codex", ["kept", id], NOW + index + 1);
    });
    expect(ledger.entries).toHaveLength(MAX_MODEL_FIRST_SEEN_ENTRIES);
    expect(firstSeen(ledger, "kept")?.origin).toBe("baseline");
    expect(firstSeen(ledger, "m-0")).toBeUndefined();
    expect(firstSeen(ledger, `m-${MAX_MODEL_FIRST_SEEN_ENTRIES - 1}`)).toBeDefined();
  });

  it("protects every provider's current models when the ledger is full", () => {
    const claude = Array.from({ length: 100 }, (_, index) => `claude-${index}`);
    const codexCurrent = Array.from({ length: 100 }, (_, index) => `codex-${index}`);
    const codexStale = Array.from({ length: 50 }, (_, index) => `gone-${index}`);
    let ledger = observeModelCatalogs(
      EMPTY_MODEL_FIRST_SEEN_LEDGER,
      [
        { provider: "claudeCode", modelIds: claude, live: true },
        { provider: "codex", modelIds: [...codexCurrent, ...codexStale], live: true },
      ],
      NOW,
    );
    const added = Array.from({ length: 10 }, (_, index) => `fresh-${index}`);
    ledger = observeModelCatalogs(
      ledger,
      [
        { provider: "claudeCode", modelIds: claude, live: false },
        { provider: "codex", modelIds: [...codexCurrent, ...added], live: true },
      ],
      NOW + DAY_MS,
    );
    expect(ledger.entries).toHaveLength(MAX_MODEL_FIRST_SEEN_ENTRIES);
    expect(claude.every((id) => findModelFirstSeen(ledger, "claudeCode", id))).toBe(true);
    expect([...codexCurrent, ...added].every((id) => firstSeen(ledger, id))).toBe(true);
    expect(codexStale.filter((id) => firstSeen(ledger, id))).toHaveLength(46);
  });

  it("does not record catalogs that are not live", () => {
    expect(
      observeModelCatalogs(
        EMPTY_MODEL_FIRST_SEEN_LEDGER,
        [{ provider: "codex", modelIds: ["a"], live: false }],
        NOW,
      ),
    ).toBe(EMPTY_MODEL_FIRST_SEEN_LEDGER);
  });

  it("re-stamps first-seen records dated more than a day in the future", () => {
    const baseline = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["a"], NOW);
    const skewed = observeLiveModelCatalog(baseline, "codex", ["a", "b"], NOW + 30 * DAY_MS);
    expect(modelIsNew({ firstSeen: firstSeen(skewed, "b") }, NOW)).toBe(false);
    const repaired = observeLiveModelCatalog(skewed, "codex", ["a", "b"], NOW);
    expect(firstSeen(repaired, "b")).toMatchObject({ firstSeenAtMs: NOW, origin: "discovered" });
    expect(firstSeen(repaired, "a")?.firstSeenAtMs).toBe(NOW);
    expect(modelIsNew({ firstSeen: firstSeen(repaired, "b") }, NOW)).toBe(true);
    expect(observeLiveModelCatalog(repaired, "codex", ["a", "b"], NOW)).toBe(repaired);
  });

  it("round-trips through the persisted shape and rejects foreign data", () => {
    const baseline = observeLiveModelCatalog(EMPTY_MODEL_FIRST_SEEN_LEDGER, "codex", ["a"], NOW);
    const ledger = observeLiveModelCatalog(baseline, "codex", ["a", "b"], NOW + DAY_MS);
    expect(parseModelFirstSeenLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
    for (const value of [
      null,
      { ...ledger, version: 2 },
      { ...ledger, extra: true },
      { ...ledger, baselineProviders: ["gemini"] },
      { ...ledger, entries: [{ ...ledger.entries[0], origin: "guess" }] },
      { ...ledger, entries: [{ ...ledger.entries[0], firstSeenAtMs: -1 }] },
      { ...ledger, entries: [{ ...ledger.entries[0], modelId: "x".repeat(200) }] },
      { ...ledger, entries: [ledger.entries[0], ledger.entries[0]] },
      {
        ...ledger,
        entries: Array.from({ length: MAX_MODEL_FIRST_SEEN_ENTRIES + 1 }, (_, index) => ({
          ...ledger.entries[0],
          modelId: `m-${index}`,
        })),
      },
    ]) {
      expect(() => parseModelFirstSeenLedger(value)).toThrow(TypeError);
    }
  });
});
