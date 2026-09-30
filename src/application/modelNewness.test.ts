import { describe, expect, it } from "vitest";
import { BUNDLED_CLAUDE_MODEL_MANIFEST } from "../domain/claudeModelCatalog";
import { BUNDLED_CODEX_MODEL_CATALOG } from "../domain/codexModelCatalog";
import { EMPTY_MODEL_FIRST_SEEN_LEDGER } from "../domain/modelNewness";
import { createModelNewness, newModelSignature } from "./modelNewness";

const TODAY = Date.parse("2026-09-30T12:00:00Z");

describe("model newness on the bundled catalogs", () => {
  it("marks only models released in the last 14 days on 2026-09-30", () => {
    const newness = createModelNewness(
      newModelSignature(
        BUNDLED_CLAUDE_MODEL_MANIFEST,
        BUNDLED_CODEX_MODEL_CATALOG,
        EMPTY_MODEL_FIRST_SEEN_LEDGER,
        TODAY,
      ),
    );
    expect(newness.isNew("claudeCode", "claude-opus-5-5")).toBe(true);
    expect(newness.isNew("claudeCode", "claude-fable-5-1")).toBe(false);
    expect(newness.isNew("claudeCode", "claude-sonnet-5")).toBe(false);
    for (const model of ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"]) {
      expect(newness.isNew("codex", model), model).toBe(true);
    }
    expect(newness.isNew("codex", "gpt-6-astra")).toBe(false);
    expect(newness.isNew("codex", "gpt-5.6-sol")).toBe(false);
  });
});
