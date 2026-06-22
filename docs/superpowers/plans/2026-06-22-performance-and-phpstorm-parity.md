# Performance + PhpStorm/VS Code parity — roadmap (2026-06-22)

Orchestrátor-driven (deleguj → nezávislý review → commit). Žiadny CodeRabbit. Per-project izolácia je posvätná — pri performance refaktore NESMIE padnúť.

## User priority
1. Rýchlosť (akútne — "dlho načítava aj keď IDE off").
2. PhpStorm IDE mode: Laravel magic/helpery + klasické OOP.
3. VS Code light mode (už blízko).

## FÁZA 1 — Performance (diagnostika hotová)
Owner: src/application/useWorkbenchController.ts (openWorkspacePath ~3817+, restoreWorkspaceSession ~3566), src-tauri (project.rs detect, managed_phpactor.rs).
- [DONE] P1: OVERENÉ — audit tvrdenie FALSE. JS-only už má fast-path (guard `if(!descriptor?.php) return` @3868 PRED drahými PHP volaniami; Rust composer.rs short-circuituje). Žiadna prod zmena, pridané 3 regression testy (commit fast-path). 1268 testov.
- [DONE] P2: commit "Parallelize workspace open...". openWorkspacePath nezávislé ops (loadDirectory/getTrust/detectWorkspace/restoreSession) cez Promise.all + restoreWorkspaceSession Promise.allSettled. ~2-4× rýchlejšie otvorenie. BONUS: review odhalil REÁLNY izolačný leak (loadDirectory subtree guard → nested→parent prepnutie pretieklo entries) → opravený (requireActiveRoot exact-root flag). detectWorkspaceTask vracia null pri stale. 1273 testov, tab-switch 130 pass.
- [ ] P2b (neskôr): odložiť basic-mode PHP probe (detectPhpTools/plan) — vyžaduje wire setSmartMode na basic→fullSmart prechod alebo lazy pri prvom PHP súbore. Multi-touch.
- [ ] P3: phpactor managed install non-blocking/background. M, MED.
- Pozn: index sa v "basic" mode NEspúšťa (shouldIndexWorkspace false) — OK.

## FÁZA 2 — PhpStorm Laravel magic
REALITY-CHECK: 5/7 TOP "gapov" UŽ FUNGUJE (false-positive): global helpers + lifecycle events + enum casts → cez phpactor (reálne triedy/funkcie z vendor); eloquent return types + app()->make typing → už v TS vrstve. NEimplementovať.
- [DONE] Eloquent return types — overené (už fungujú), pridané ochranné testy (commit "Cover Eloquent...").
- [DONE] Higher-order collection proxy ($users->map->email, $posts->filter->isPublished()) — commit "Resolve Laravel higher-order...". Nový phpLaravelHigherOrderProxy.ts, 27 proxy metód, konzervatívne. REÁLNA magic ktorú phpactor nevidí. 1282 testov.
- ZOSTÁVA reálne: OOP code generation (implement interface/getters/constructor) — HIGH hodnota, ale HIGH náročnosť (custom parser+gen, phpactor neposkytuje) = VEĽKÁ investícia → produktové rozhodnutie pre usera.

## FÁZA 3 — PhpStorm OOP + robustnosť
Code generation (implement interface/getters/constructor — phpactor neposkytuje, custom), type/call hierarchy UI (OVERIŤ čo reálne chýba — sporné s predošlým auditom že existuje cez command palette), phpactor health-check + auto-restart, organize-imports PHP, request timeout tuning.

## FÁZA 4 — VS Code light doladenie (už blízko)

## Postup: každý slice = over audit tvrdenie v kóde (audity nadhodnocujú) → TDD → samostatný review → commit. Izolácia vždy zachovaná.
