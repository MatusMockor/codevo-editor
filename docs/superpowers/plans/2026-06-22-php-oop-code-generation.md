# PHP OOP Code Generation — kontextové (PhpStorm-like, lepšie) — 2026-06-22

Orchestrátor-driven (deleguj → nezávislý review → commit/push, `git pull --rebase` kvôli kolegovi). Žiadny CodeRabbit. Per-workspace izolácia posvätná. SOLID, guard clauses, žiadne over-engineering.

## Cieľ (user)
Code generation ako PhpStorm, ale KONTEXTOVÉ — nie šablóny. Číta REÁLNU štruktúru (interface signatúry s presnými typmi/PHPDoc, properties s typmi, namespace, use). Ak sa dá, LEPŠIE ako PhpStorm (Laravel-aware, phpstan/psalm typy, alias-aware auto-import).

## Architektúra (Plan agent, overené v kóde)
**TS-only, reuse PHP semantic vrstvy.** NIE Rust tree-sitter (dáva len outline — meno+kind+range, bez signatúr/typov/PHPDoc/relations), NIE phpactor (advertise-uje len "quickfix", neposkytuje implement-methods).
- REUSE: `resolvePhpClassName` + `use` import handling (phpClassNameResolution.ts), `phpSuperTypeReferences`/`phpCurrentTypeKind`/`phpExtendsClassName`/`phpClassPathCandidates` (phpNavigation.ts), `phpMethodParameters` + PHPDoc enrich (phpMethodCompletions.ts), `firstPhpDocTypeToken` (phpDocTemplates.ts), cross-file `resolvePhpClassSourcePaths` (useWorkbenchController.ts:7600) + `readNavigationFileContent` + `collectPhpMethodsForClass` walker (:7830, per-workspace izolácia `isRequestedRootActive`), Monaco edit pipeline + lokálna code-action (vzor "Remove unexpected identifier" languageServerMonacoProviders.ts:1588).
- NOVÉ: `domain/phpClassStructure.ts` (full-member parser BEZ public-only filtra + `PhpMember` model), `domain/phpCodeGen.ts` (stub + use-import render), `domain/phpInsertionPoint.ts` (insertion point + import edit), context callback `providePhpCodeActions` (vzor `providePhpMethodCompletions`).

## Roadmap (podľa hodnoty)
- **Slice 1 — Implement interface / abstract methods** ⭐ najvyššia hodnota, fundament (postaví full-member parser + stub gen + insertion + code-action wiring).
- **Slice 2 — Generate getters/setters** (po S1, reuse property parsing; nie cross-file).
- **Slice 3 — Generate constructor (+ PHP 8 promotion)** (po S1/S2).
- **Slice 4 — Create method/property from usage** (najvyššia náročnosť; type inference z call-site cez phpSemanticEngine).

## "Lepšie ako PhpStorm"
PHPDoc/phpstan/psalm typy v stuboch (`@return array<int,\App\User>`); Laravel-aware (Eloquent relation/accessor stubs, `@property` typy z modelu); alias-aware auto-import; union/intersection/nullable verne (raw signature render); promotion-aware constructor.

## Riziká
Regex edge cases (variadic `...`/by-ref `&`/intersection `A&B`/union/nullable/multi-line sig/`#[Attr]`) → testovať od začiatku, použiť `matchingPairOffset` (balanced) nie `[^)]*`. Insertion point cez `matchingPairOffset` od class `{` (nie krehký regex). Per-workspace izolácia v každom async kroku (`isRequestedRootActive`). Cross-file resolution fail → NIKDY negenerovať nesprávne signatúry (degradovať/nezobraziť). Async latency → cache (`phpClassMemberCacheRef` vzor, `phpSourceSignature`).

## Slice 1 — HOTOVÝ ✅ (implement interface methods, end-to-end, full 1460 pass)
Commity: `b8d103dc` (1a parser) → `842b3203` (1b render + 1c insertion) → `52120263` (1d integrácia + 1e wiring).
"Implement methods" Monaco quick-fix na PHP triede s neimplementovaným interface/abstract → vloží stubs so správnymi signatúrami (cross-file z reálneho interface, PHPDoc/phpstan typy, union/intersection/nullable/variadic/by-ref verne) + konzervatívne `use` importy. Per-workspace izolácia testovaná (drop-on-switch na provider AJ computation vrstve). Review pozn.: 2. review tvrdil chýbajúci drop test = FALSE-POSITIVE (testy existujú na riadkoch 4786/4846/40483, overené behom).

## Slice 1 rozdelenie (TDD, každý: deleguj → review → commit)
- **1a** `phpClassStructure.ts` — `PhpMember` model (meno, params s typmi/default/variadic/by-ref, return type, PHPDoc @param/@return, visibility, static, abstract) + full-member parser (všetky members, nie public-only). Reuse `phpMethodParameters`/`matchingPairOffset`. Pokryť edge cases. FUNDAMENT.
- **1b** `phpCodeGen.ts` — render stub z `PhpMember` (visibility, presné typy, PHPDoc blok, telo throw/TODO, static, indentácia) + use-import lines. (po 1a)
- **1c** `phpInsertionPoint.ts` — pozícia inzertu pred class `}` (matchingPairOffset), estetika (prázdne riadky), use-import edit za posledný `use`/`namespace`. (po 1a; paralelne s 1b)
- **1d** integrácia — `providePhpCodeActions` callback (languageServerMonacoProviders.ts context + provideCodeActions async vetva), wiring v useWorkbenchController.ts (reuse resolvePhpClassSourcePaths + collectPhpMethods walker → diff chýbajúcich metód), Monaco code action "Implement methods" + workspace edit. Per-workspace izolácia + cache. (po 1a/1b/1c)

## STAV (2026-06-22 večer)
- Slice 1 (implement interface methods) HOTOVÝ + reálne otestovaný na kontentino/api (kontextové generovanie OK, validný PHP, správne use importy).
- OTVORENÉ: phpactor stale diagnostika po code-action edite (status bar "1 error" + phpactor "Implement contracts" visia po implementácii). Probe (3 dočasné logy v useWorkbenchController.ts + EditorSurface.tsx, NECOMMITNUTÉ) dokázal: `[probe1 didChange->]` odíde, ale `[probe2 publishDiag<-]` NIKDY → phpactor nere-publikuje. Frontend OK (probe3 by clearol keby prišiel n=0).
- Capabilities hypotéza VYVRÁTENÁ (subagent naklonoval phpactor zdroj): diagnostics-on-update je capability-independent, gated len config (diagnostics_on_update/save/open=true). Reálne kandidáti: (1) debounce+current-doc race v DiagnosticsEngine (1000ms sleep; didChange+didSave tesne → runs sa superseder-ujú), (2) diagnostic_outsource=true subprocess zlyháva v sandboxe, (3) version mismatch enqueueSave.
- ĎALŠÍ KROK (zajtra): rozlišovací test — napíš metódy RUČNE (nie code action) → zmizne error? Ak áno → náš flow (didChange+didSave race), fixnuteľné u nás. Ak nie → všeobecný phpactor refresh limit (samostatný issue). + ak možno phpactor trace / diagnostic_outsource=false test. Potom odstrániť probe logy + cielený fix alebo označiť ako phpactor limit.

## ŠIRŠÍ ROADMAP k PhpStorm parity (IDE mode)
Už máme: generic PHP/PHP8 cez phpactor (hover/def/rename/completion/enums/promotion/readonly/attributes/match/code actions), Laravel magic (eloquent typy, helpery, higher-order proxy, route/model/Gate/Policy/middleware nav, validation completion), OOP code-gen Slice 1.
1. Dokončiť OOP code-gen: Slice 2 getters/setters, Slice 3 constructor(+promotion), Slice 4 create method/property from usage. [rozbehnuté, HIGH]
2. Laravel nav/completion balík: config()/route()/view()/__()/trans()/env() string literály → navigácia + completion (PhpStorm Laravel plugin parita). [MED náročnosť, HIGH denná hodnota]
3. Refactoring suite: extract method/variable, change signature, inline, organize/optimize imports (remove unused use), reformat PSR-12. [MED-HIGH]
4. Blade template support: nový jazyk subsystém (highlight, completion, Blade↔controller nav, @directives, components). [LARGE, HIGH pre Laravel]
5. Robustnosť: phpactor diagnostic refresh fix (viď vyššie), health-check + auto-restart, viac quick-fixov/inšpekcií.
6. UI parity: type/call hierarchy UI, find usages panel, structure/outline (máme breadcrumbs), TODO view.

## NOČNÝ ŠPRINT — hotové (2026-06-23), full suite 1775 testov zelená
Každý slice: TDD → nezávislý review → commit/push, per-workspace izolácia overená, git pull --rebase priebežne.
- #1 OOP CODE-GEN ✅ KOMPLETNÉ: implement interface methods, generate getters/setters, generate constructor (+promotion), create method/property from usage, optimize imports, extract variable. Code actions cez Cmd+. (providePhpCodeActions, source+range).
- #2 LARAVEL nav/completion ✅: completion (config/view/trans) UŽ EXISTOVALA (phpLaravelConfig/Views/Translations — nededuplikované); pridaná Cmd+Click nav (providePhpLaravelDefinition) na config/view/trans/env/route literály.
- #3 REFACTORING: optimize imports ✅, extract variable ✅, Format Document command (Shift+Alt+F) ✅. NECHANÉ (L, produktové rozhodnutie usera): change signature, inline, extract method.
- #4 BLADE: syntax UŽ existovala (Shiki blade grammar — bladeLanguage Monarch duplikát zahodený); pridaná nav (Cmd+Click @include/@extends/@component/<x-comp>) + completion (@direktívy, view/component names) pre "blade" language.
- #5 ROBUSTNOSŤ: phpactor + TS LSP auto-restart pri crashe ✅ (backoff/limit/per-workspace izolácia, zapojené v lib.rs). Diagnostic refresh po edite = ZNÁMY phpactor-internal problém (čaká rozlišovací test 1 — ručný edit; capabilities hypotéza vyvrátená).
- #6 UI PANELY: type/call hierarchy + structure + breadcrumbs UŽ EXISTOVALI; pridaný TODO panel (Cmd+Shift+T) + Find References panel (Shift+F12).
- POZN: laravelKeyExtraction.ts commitnutý ale nateraz NEVYUŽITÝ (completion má vlastné extraktory) — ráno zapojiť do completion alebo odstrániť.

## Postup per slice
deleguj (write scope + TDD + zákaz revertu cudzích zmien + žiadny CodeRabbit) → samostatný review agent → integruj → testy + npm run check → commit/push (žiadna AI attribution) → update plánu.
