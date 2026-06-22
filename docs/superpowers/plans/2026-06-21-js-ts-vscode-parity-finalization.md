# JS/TS VS Code Parity — Finalization Phase (2026-06-21)

Orchestrátor-driven. Hlavný agent NEimplementuje — deleguje na subagentov, reviewuje (samostatný
review agent, **NIE CodeRabbit**), integruje, testuje, commituje. Per-project izolácia = kritická priorita.

## Checkpoint (overený stav, nie pocit)
- Branch `main`, synced `origin/main`, working tree clean.
- `npm run check` → exit 0 (žiadny PHP/Laravel WIP blocker, repo zdravé).
- File watchers: per-workspace izolované (test `registry_routes_notifications_to_the_requested_workspace_only`).
- Terminály: per-workspace (keyed by cwd), cleanup OK (test `stop_root_kills_only_matching_workspace_sessions`).
- Quit/window-close: `shutdown_runtime_processes()` (3 miesta) + Rust `Drop` impls (SIGTERM→SIGKILL).
- Tab-switch nechá background runtime bežať = keep-alive (VS Code-like, NIE data leak). Suspend/single-active = budúce produktové rozhodnutie.

## Verifikované verdikty auditu (aby sa false-positives znova neskúmali)
FALSE (neimplementovať):
- completion trigger-kind mapping (kód správny: Monaco 0-based→LSP 1-based)
- call hierarchy / type hierarchy / source definition "chýba" → existujú cez command palette + handlers + testy
- diagnostic related-info range / code-description link → oba správne
- auto-closing brackets → funguje defaultne; format-on-type → existuje; inlay hints → už granular

REAL (slice kandidáti, podľa hodnoty):
1. Format on Save — REAL-MISSING, HIGH. Owner: settings model+UI, save flow.
2. Cmd+T Workspace Symbols UI — provider hotový, chýba UI/binding pre JS/TS. HIGH.
3. Outline panel / Breadcrumbs pre JS/TS — UI je PHP-only. MEDIUM.
4. Workspace-edit post-await guard + test — izolačný hardening, nízky risk, test-gap. LOW-MED.

SPORNÉ (hlbšie overiť pred delegáciou):
- hover markdown rendering (reasoning agenta rozporný; Monaco IMarkdownString renderuje value ako markdown)
- external .d.ts/node_modules go-to-definition (v napätí s dizajnom `2acf5b5` — definition povoľuje external, references/symbols filtrované)

## Rozhodnutia (orchestrátor, VS Code parity)
- formatOnSave default OFF (VS Code parity), configurable. Ak formatting zlyhá/timeout → save aj tak pokračuje.
- Per-workspace izolácia musí ostať zachovaná vo všetkých slices (capture root + guard).

## Slice pipeline
- [DONE] SLICE A: Format on Save — commit 4f9687c1. settings.formatOnSave (default false) + planFormatOnSave helper + SettingsDialog toggle + saveActiveDocument format-before-write s per-root guardmi. 433 preview testy + izolačný tab-switch test (dokázaný: vypnutie guardu → FAIL). npm run check OK.
- [DONE] SLICE B: Workspace-edit post-await guard + test — commit ab364781. flush+re-check pred mutáciou Monaco modelov v applyWorkspaceEditEvent. 65 testov + nový leak test. APPROVE.
- [DONE] re-verify SPORNÉ → OBA FALSE: hover markdown (markup_to_string zachová MD, Monaco renderuje value ako MD); external .d.ts def (definition/impl/typeDef volajú toMonacoLocations bez rootPath → external OK; references s rootPath → filtrované; konzistentné s 2acf5b5). Neimplementovať.
- [DONE] SLICE A2: Flush pending changes pred format-on-save — commit (flush-before-format). Gap agent našiel reálny bug (formatter dostal stale obsah); helper flushPendingDocumentChangeForFormatOnSave + re-check po await. Test dokazuje poradie (invocationCallOrder). 434 pass. APPROVE.
- [DONE] SLICE C: VS Code Cmd+T "Go to Symbol in Workspace" pre JS/TS — commit (Go to Symbol). Nový WorkspaceSymbols.tsx modal + editor.goToSymbol (Cmd+T), reuse searchClassOpenSymbols BEZ type-filtra (všetky symboly), capability gating, izolácia (drop-on-switch test), Cmd+O zachované. 1173 testov pass. APPROVE.
- [DONE] SLICE D: Problems/diagnostics UX — commit bc115bb4. Error/warning count v status bare (per aktívny workspace) + Go to Next/Previous Problem (F8/Shift+F8, wrap, cross-file order). Čisté helpery diagnosticsSummary.ts + problemNavigation.ts. Izolácia overená. APPROVE.

## FINÁLNY CHECKPOINT JS/TS fázy (verifikované)
- Finálna brána: full vitest 84 files / 1192 testov PASS; npm run build OK; npm run check OK.
- HIGH-value JS/TS VS Code parity gapy DODANÉ. Audit/verifikácia odfiltrovali ~10 false-positives (neimplementované zbytočne).
- ZOSTÁVAJÚCE nice-to-have / produktové (NEurobené, vyžadujú produktové rozhodnutie alebo nízka hodnota):
  - format on paste (S, MEDIUM)
  - per-language tab-size / user-configurable indent pri formátovaní (M; teraz hardcoded {insertSpaces:true,tabSize:2} — ovplyvňuje correctness format-on-save pre projekty s iným indentom)
  - emmet pre JSX (M, externá závislosť)
  - breadcrumbs (L, LOW pre JS/TS)
- ROZHODNUTIE: JS/TS light mode je realisticky čo najbližšie k VS Code pre HIGH-value. Ďalší smer (zvyšné JS/TS nice-to-have vs prechod na PHP IDE mode) = míľnik medzi fázami → potvrdiť s userom.

## PHP IDE mode fáza (po JS/TS)
- Audit + verifikácia: prvý audit ~80-85% PhpStorm parity; druhý audit tvrdil ~50-55% (0% PHP8/code-gen) — VERIFIKÁCIOU VYVRÁTENÝ: PHP8 (enums, constructor promotion, readonly, attributes, match), code actions (implement contract, generate accessor/constructor, add use), rename cross-file, hover/def/inlay/symbols VŠETKO funguje cez phpactor LSP (2026.05.30.2). Projekt správne deleguje generic PHP na phpactor; TS vrstva = Laravel semantika + false-positive suppression.
- Reálne PHP gapy (po odfiltrovaní false-positives): MorphTo/contextual-binding/@method-overloading UŽ existujú. Dodané: dynamic route($var) nav (F), model mutation chains (G). Zostáva: Blade (VEĽKÉ produktové — nový jazyk subsystém), Laravel-advanced (gate/policy, events, factories, validation, macros LARGE) — klesajúca hodnota.
- [DONE] SLICE F: Navigate route helpers using assigned string literals — commit cb35c3e7.
- [DONE] SLICE G: Preserve model type through visibility and append mutations — commit 0cbcd845.

## Commity tejto fázy
- ab364781 Guard server-initiated JS TS workspace edits during tab switches (B)
- 4f9687c1 Add format on save for editor documents (A)
- c70f986b Flush pending document changes before format on save (A2)
- f9370a3c Add Go to Symbol in Workspace command for JS TS (C)
- bc115bb4 Add problems count and go to next previous problem (D)

## Postup per slice
deleguj (write scope + TDD + zákaz revertu cudzích zmien) → samostatný review agent → integruj/uprav →
spusti relevantné testy + npm run check → commit (bez AI attribution / Co-Authored-By) → push → update tohto plánu.
