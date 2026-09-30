// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import wireContract from "../../contracts/codex-model-catalog-wire.json";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  parseClaudeModelManifest,
  type ClaudeModelManifest,
} from "../domain/claudeModelCatalog";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  parseCodexModelCatalog,
  type CodexModelCatalog,
} from "../domain/codexModelCatalog";
import { EMPTY_MODEL_FIRST_SEEN_LEDGER, type ModelFirstSeenLedger } from "../domain/modelNewness";
import type { ModelFirstSeenRepository } from "./modelFirstSeenRepository";
import { NO_MODEL_NEWNESS, type ModelNewness } from "./modelNewness";
import { useModelNewness } from "./useModelNewness";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");
const liveCodexModel = { ...wireContract.catalogs[0].value.models[1], status: "current" };

function codexLive(revision: number, ids: ReadonlyArray<string>): CodexModelCatalog {
  return parseCodexModelCatalog({
    version: 1,
    source: "live",
    revision,
    models: ids.map((id, index) => ({
      ...liveCodexModel,
      id,
      isDefault: index === 0,
      upgradeTo: null,
    })),
  });
}

function claudeLive(badged: ReadonlyArray<string>): ClaudeModelManifest {
  return parseClaudeModelManifest({
    version: 1,
    source: "live",
    updatedAt: "2026-09-29T20:20:00Z",
    claudeCode: BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.map(
      ({ description: _description, ...entry }) => ({
        ...entry,
        isNew: badged.includes(entry.choice),
      }),
    ),
  });
}

class MemoryRepository implements ModelFirstSeenRepository {
  writes = 0;
  constructor(public ledger: ModelFirstSeenLedger = EMPTY_MODEL_FIRST_SEEN_LEDGER) {}
  read(): ModelFirstSeenLedger {
    return this.ledger;
  }
  write(ledger: ModelFirstSeenLedger): void {
    this.writes += 1;
    this.ledger = ledger;
  }
}

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderNewness(
  repository: ModelFirstSeenRepository,
  claude: ClaudeModelManifest,
  codex: CodexModelCatalog,
  now: { current: number },
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  let current: ModelNewness = NO_MODEL_NEWNESS;
  const clock = () => now.current;
  function Harness(props: {
    readonly claude: ClaudeModelManifest;
    readonly codex: CodexModelCatalog;
  }) {
    current = useModelNewness(repository, props.claude, props.codex, clock);
    return null;
  }
  act(() => root.render(<Harness claude={claude} codex={codex} />));
  unmounts.push(() => act(() => root.unmount()));
  return {
    get newness() {
      return current;
    },
    rerender(nextClaude: ClaudeModelManifest, nextCodex: CodexModelCatalog) {
      act(() => root.render(<Harness claude={nextClaude} codex={nextCodex} />));
    },
  };
}

describe("useModelNewness", () => {
  it("uses the live Claude flag but not for a model whose bundled release date is stale", () => {
    const view = renderNewness(
      new MemoryRepository(),
      claudeLive(["claude-opus-5-5", "claude-fable-5-1"]),
      BUNDLED_CODEX_MODEL_CATALOG,
      { current: NOW },
    );
    expect(view.newness.isNew("claudeCode", "claude-opus-5-5")).toBe(true);
    expect(view.newness.isNew("claudeCode", "claude-fable-5-1")).toBe(false);
  });

  it("falls back to bundled release dates when no live flag exists", () => {
    const view = renderNewness(
      new MemoryRepository(),
      BUNDLED_CLAUDE_MODEL_MANIFEST,
      BUNDLED_CODEX_MODEL_CATALOG,
      { current: NOW },
    );
    expect(view.newness.isNew("claudeCode", "claude-opus-5-5")).toBe(true);
    expect(view.newness.isNew("claudeCode", "claude-fable-5-1")).toBe(false);
    expect(view.newness.isNew("claudeCode", "claude-opus-5")).toBe(false);
    expect(view.newness.isNew("codex", "gpt-6.1-sol")).toBe(true);
    expect(view.newness.isNew("codex", "gpt-5.6-sol")).toBe(false);
  });

  it("baselines the first live catalog and shows NEW only for models that appear later", () => {
    const repository = new MemoryRepository();
    const now = { current: NOW };
    const view = renderNewness(
      repository,
      BUNDLED_CLAUDE_MODEL_MANIFEST,
      codexLive(1, ["gpt-undated-a"]),
      now,
    );
    expect(view.newness.isNew("codex", "gpt-undated-a")).toBe(false);
    expect(repository.ledger.baselineProviders).toEqual(["codex"]);

    now.current = NOW + DAY_MS;
    view.rerender(BUNDLED_CLAUDE_MODEL_MANIFEST, codexLive(2, ["gpt-undated-a", "gpt-undated-b"]));
    expect(view.newness.isNew("codex", "gpt-undated-a")).toBe(false);
    expect(view.newness.isNew("codex", "gpt-undated-b")).toBe(true);
    expect(repository.writes).toBe(2);
  });

  it("hides a first-seen NEW badge after 14 days on the next evaluation", () => {
    const repository = new MemoryRepository();
    const now = { current: NOW };
    const view = renderNewness(
      repository,
      BUNDLED_CLAUDE_MODEL_MANIFEST,
      codexLive(1, ["gpt-undated-a"]),
      now,
    );
    view.rerender(BUNDLED_CLAUDE_MODEL_MANIFEST, codexLive(2, ["gpt-undated-a", "gpt-undated-b"]));
    expect(view.newness.isNew("codex", "gpt-undated-b")).toBe(true);
    now.current = NOW + 15 * DAY_MS;
    view.rerender(BUNDLED_CLAUDE_MODEL_MANIFEST, codexLive(3, ["gpt-undated-a", "gpt-undated-b"]));
    expect(view.newness.isNew("codex", "gpt-undated-b")).toBe(false);
  });

  it("keeps the same newness object across clock changes that do not change the NEW set", () => {
    const now = { current: NOW };
    const view = renderNewness(
      new MemoryRepository(),
      BUNDLED_CLAUDE_MODEL_MANIFEST,
      BUNDLED_CODEX_MODEL_CATALOG,
      now,
    );
    const first = view.newness;
    now.current = NOW + 60_000;
    view.rerender(
      BUNDLED_CLAUDE_MODEL_MANIFEST,
      parseCodexModelCatalog(BUNDLED_CODEX_MODEL_CATALOG),
    );
    expect(view.newness).toBe(first);
    now.current = NOW + 20 * DAY_MS;
    view.rerender(
      BUNDLED_CLAUDE_MODEL_MANIFEST,
      parseCodexModelCatalog(BUNDLED_CODEX_MODEL_CATALOG),
    );
    expect(view.newness).not.toBe(first);
    expect(view.newness.isNew("codex", "gpt-6.1-sol")).toBe(false);
  });

  it("never records bundled catalogs as a baseline", () => {
    const repository = new MemoryRepository();
    renderNewness(repository, BUNDLED_CLAUDE_MODEL_MANIFEST, BUNDLED_CODEX_MODEL_CATALOG, {
      current: NOW,
    });
    expect(repository.writes).toBe(0);
    expect(repository.ledger).toBe(EMPTY_MODEL_FIRST_SEEN_LEDGER);
  });
});
