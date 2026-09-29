# Codex live model catalog

Goal: Codex (OpenAI) models get the same architecture as Claude models - a bundled
fallback manifest plus a validated live catalog, one immutable backend snapshot used for
both the picker and launch validation, and no hard-coded model enum at the Rust boundary.

## How the Claude catalog works today (reference)

- Bundle: `src/domain/claudeModelManifest.json`, parsed strictly on both sides
  (`claudeModelCatalog.ts`, `claude_model_manifest_domain.rs`).
- Live source: public t3code manifest over HTTPS (`claude_model_manifest.rs`), adapted by
  `claude_model_manifest_t3.rs`, 256 KiB cap, 10 s timeout, single-flight refresh lease,
  1 h TTL / 5 min retry, atomic last-good disk cache, no rollback to older `updatedAt`.
- IPC: `get_claude_model_manifest` (snapshot + refresh trigger) and the
  `claude-model-manifest-updated` event. TS: `TauriClaudeModelCatalogGateway` ->
  `useClaudeModelCatalog` (subscribe first, then read, poll every 60 s, never publish an
  older snapshot) -> `ClaudeModelCatalogProvider` context in `main.tsx`.
- Launch: `ClaudeModelChoice` is a bounded syntactic newtype; catalog membership and
  capabilities are enforced by `AgentLaunchOptions::validate_manifest` against one
  snapshot. Removed saved choices stay parseable but cannot pass launch validation.
- NEW badge: curated `CLAUDE_NEW_MODEL_IDS` in `agentLaunch.ts`, checked against the
  bundle by a test.

## Source of truth for Codex: app-server `model/list`

Evidence (Codex CLI 0.159.1 on this machine):

- `codex app-server generate-json-schema` exposes `model/list` in the v2 protocol with
  `ModelListParams { cursor, includeHidden, limit }` and
  `ModelListResponse { data: Model[], nextCursor }`.
- A live probe (`initialize`, `initialized`, `model/list {includeHidden:true}`) returned 10
  models in about 2 s, including `gpt-6.1-sol` (`isDefault: true`) which was not yet in
  `~/.codex/models_cache.json`; the probe itself refreshed that cache
  (`client_version` 0.158.0 -> 0.159.1).
- `models_cache.json` is Codex's internal, undocumented cache (snake_case, `visibility:
"list"|"hide"`, no `isDefault`, ~350 KB with prompt text). `model/list` is the
  versioned contract that serves the same data and falls back to that cache offline.

Decision: the live source is `model/list` through a short-lived `codex app-server --stdio`
probe of the exact trusted provider executable (same pattern as the existing
`account/rateLimits/read` usage probe). `models_cache.json` is not read by Codevo.

Fields used from `Model`: `id`, `model`, `displayName`, `description`, `hidden`,
`isDefault`, `supportedReasoningEfforts[].reasoningEffort`, `defaultReasoningEffort`,
`upgradeInfo.model` (fallback `upgrade`). Ignored: service tiers, modalities, access
programs, availability NUX, multi-agent metadata, effort descriptions.

## Adapter rules (upstream -> Codevo catalog)

Upstream JSON is read leniently (unknown upstream fields are ignored), then converted to
the strict Codevo wire. The whole response is rejected (last good snapshot kept) when:
the payload exceeds 256 KiB, is not JSON-RPC with the expected `id`, `nextCursor` is not
null (partial list), there are more than 128 entries, a required field is missing or has
the wrong type, a visible entry has `id != model`, an unsafe id, invalid label/description
text, duplicate ids, or the visible set is empty or does not have exactly one default.

Per-entry filtering (not truncation): `hidden: true` entries (for example
`codex-auto-review`, `gpt-reserve`) are excluded from the picker. Unknown reasoning
efforts are dropped from a model (forward compatible); an unknown or `null`
`defaultReasoningEffort` becomes `null` (use the Codex CLI default), and a missing
`hidden` is treated as `false`, so small upstream schema drift keeps the live list. A model with `upgradeInfo` is
`legacy` (shown in the picker's legacy section, like Claude) and records `upgradeTo`.

Model id syntax: `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`, at most 64 bytes, never starts with `-`.
Closed effort set: `none, minimal, low, medium, high, xhigh, max, ultra`.

## Codevo wire contract

`contracts/codex-model-catalog-wire.json` (tested by Rust and TS):

```json
{ "version": 1, "source": "live" | "bundled", "revision": 3,
  "models": [{ "id", "label", "description", "status": "current" | "legacy",
               "isDefault", "efforts": [...], "defaultEffort": effort | null,
               "upgradeTo": id | null }] }
```

Strict on both sides: unknown fields rejected, at most 64 models, bounded text, exactly
one default, `defaultEffort` must be one of `efforts`, `bundled` has revision 0 and
`live` has revision >= 1. `revision` is a backend monotonic counter so late or reordered
events never replace a newer snapshot in the UI.

The bundle is `src/domain/codexModelManifest.json` in the same shape; it replaces
`agentModelManifest.json`, `CODEX_MODEL_CHOICES` and the Rust `CodexModelChoice` enum.

## Caching and refresh

- Backend service `codex_model_catalog.rs`: bundled snapshot at startup, live snapshot
  installed atomically with the provider generation it came from.
- Triggers: after Codex provider policy registration (startup and settings changes),
  after a successful Codex provider update (invalidate + refresh), and on
  `get_codex_model_catalog` when due (1 h TTL, 5 min retry, immediate when the current
  provider generation differs from the snapshot's). Single-flight RAII lease.
- The probe runs under its own catalog-probe lease for the current generation. It is
  refused while updating, signing in or disabled, but it is not an active turn and never
  blocks update or sign-in: starting either cancels the running probe (checked every
  10 ms), which installs nothing and schedules a retry. Shutdown and generation changes
  cancel it too, and results are installed only if the lease and the exact executable
  resolution are still current and the generation is not older than the installed one.
- No extra Codevo disk cache: the Codex CLI already persists its catalog and `model/list`
  serves it offline. Until the first probe completes the bundle is used.
- TS mirrors Claude: `TauriCodexModelCatalogGateway` (strict parse of snapshots and
  events), `useCodexModelCatalog` (subscribe, read, poll every 60 s, keep the highest
  revision), `CodexModelCatalogProvider` in `main.tsx`.

The catalog is app-global public metadata (one Codex executable/account per app), not
per workspace, so workspace A -> B -> A has no catalog state to leak. Provider-generation
ownership replaces workspace ownership.

## Picker and launch in TS

- Rows come from the catalog; every row shows its description. Only the configured model
  (from `config.toml` discovery) appends "Selected by your Codex configuration." The
  catalog default gets the default marker; legacy models go to the legacy section.
- NEW badge: curated `CODEX_NEW_MODEL_IDS`, same rule and bundle test as Claude.
- Effort: Codex launches gain an optional `effort` (absent = no override, so
  `config.toml` or the model default applies). The effort picker lists the selected
  model's efforts from the catalog plus a "Default" entry; the trigger reads "Default"
  until an explicit level is chosen, and the catalog default level is only marked as
  "Model default". Switching model clears the override.
- Stored launches: a Codex model that is not in the current catalog is resolved like the
  `default` sentinel (`codexEffectiveModel`): the model named by the Codex configuration
  when the catalog lists it, otherwise the catalog default, otherwise no `-m` when the
  configuration names an unlisted model. The stored effort is dropped for that turn. The
  composer shows a visible note, and the stored value is not rewritten, so it comes back
  if the model reappears. (Claude keeps the stale id and the backend refuses it; Codex
  falls back as requested.) Queued follow-ups and retries that bypass the composer are
  still refused by the backend instead of falling back.

## Launch validation at the Rust boundary

- `CodexModelChoice` becomes a bounded syntactic newtype like `ClaudeModelChoice`;
  `CodexEffortChoice` is a closed enum (`#[serde(default)]`, skipped when default, so
  existing thread documents round-trip unchanged).
- `validate_capabilities` / `validated_catalog_args` resolve the model in the snapshot:
  the live visible models once a live list exists, otherwise the bundled models (the
  same rule the TS picker uses). Unknown or hidden model, or an effort the model does
  not support -> refused before spawn with the existing capability error. `default`
  resolves to the catalog default for effort checks.
- Args stay a closed typed plan: `-m <validated id>` and
  `-c model_reasoning_effort="<closed value>"` for `codex exec`; `model` on thread
  start/resume and `model` + `effort` on `turn/start` for the app-server transport.

## Remaining gaps

- The composer checks catalog membership against the frontend snapshot, which can lag the
  backend by up to one 60 s poll after a live change (event delivery normally closes the
  gap). A launch in that window may be refused by the backend; the next poll corrects it.

- The live list reflects the Codex CLI's account and default provider; custom
  `model_providers` with non-conforming ids are refused, not listed.
- Effort descriptions and service tiers (Fast) from `model/list` are not surfaced yet.
