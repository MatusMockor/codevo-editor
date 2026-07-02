# Nette + Latte Framework Support - Design (Fáza 1)

Dátum: 2026-07-02
Stav: Design (pred implementačným plánom)
Rozsah: Fáza 1 - framework-profil detekcia + framework-agnostic gating refaktor + Latte templating (FE)

## 1. Cieľ

Pridať do Codevo Editora podporu pre **Nette** (PHP framework) a jeho šablónovací engine **Latte** (obdoba Blade), s **per-workspace prepínaním**: keď IDE mode v otvorenom projekte zistí Nette, Laravel "magic" + Blade sa preň **nezapnú** (a naopak). Existujúci light mode (JS/TS, VS Code parity) a Laravel IDE mode (PhpStorm parity) sa správaním **nesmú zmeniť**.

Fáza 1 pokrýva:
1. Framework-profil detekciu (`Laravel | Nette | Generic`) z `composer.json`, per-workspace, exkluzívnu.
2. Plný framework-agnostic refaktor gating vrstvy (dnes hardcoded `isLaravelFrameworkActive` na ~171 miestach) na provider-driven dispatch.
3. Latte templating FE: `.latte` jazyk + highlighting, `{$var}` echo / `{foreach}` / `n:attributes`, `{include}`/`{layout}`/`{extends}` completion + Cmd+B, premenné z presenteru (`$this->template->x`).

**Mimo rozsahu Fázy 1** (samostatné neskoršie fázy): plný Nette PHP semantic (DI container autowiring, presenter konvencie, component factory), NEON config (`services.neon`, parameters) inteligencia, Symfony provider.

## 2. Rozhodnutia z brainstormingu

- **Detekcia frameworku**: auto z `composer.json`. `laravel/framework` → Laravel; `nette/application` alebo `latte/latte` → Nette; inak Generic (phpactor only). Bez manuálneho override (Fáza 1).
- **Gating stratégia**: plný framework-agnostic refaktor. Rozšíriť `PhpFrameworkProvider` interface o chýbajúce kapability a presunúť ~171 `isLaravelFrameworkActive` gate-ov na provider dispatch. **Behavior-preserving pre Laravel** - existujúca test suita (4205+ testov) je regresná poistka.
- **Vrstvenie (Fleet model)**: highlighting tier beží vždy (aj `basic`/light), semantic tier len vo `fullSmart` + príslušný framework profil. JS/TS light mode je oddelená vetva - nedotýkame sa jej.
- **Verify**: Fáza 1 sa overuje fixtúrami (testovací Nette/Latte fixture: presenter + `.latte` + `composer.json`). End-to-end QA na reálnom Nette projekte je follow-up (vyžaduje reálny projekt).

## 3. Súčasný stav (grounding, overené prieskumom kódu)

### 3.1 IDE mode / intelligence
- `IntelligenceMode = "basic" | "lightSmart" | "fullSmart"` - `src/domain/workspace.ts:215`; backend mirror `src-tauri/src/smart_mode.rs:5`.
- `shouldStartLanguageServer(mode)` → iba `fullSmart` spúšťa phpactor - `src/domain/intelligence.ts:20`.
- `intelligenceMode` je per-workspace setting (`src/domain/settings.ts:140`, default `"basic"`), pri otvorení workspace sa globálny backend zosúladí: `smartModeGateway.setMode(...)` - `useWorkbenchController.ts:5760`.

### 3.2 Framework detekcia (UŽ podmienená, nie bezpodmienečná)
- `isLaravelPhpProject(php)` - `src/domain/phpFrameworkProviders.ts:459` (composer `laravel/laravel` alebo `laravel/framework`).
- `interface PhpFrameworkProvider` s `appliesTo(php)` - `phpFrameworkProviders.ts:76`; jediná impl. `phpLaravelFrameworkProvider` (`id: "laravel"`) - `:110`.
- Registry `phpFrameworkProviderRegistry = [phpLaravelFrameworkProvider]` - `:222`; komentár `:216-221` explicitne značí seam pre Nette/Symfony. V testoch už existuje `netteProvider` fixture - `phpFrameworkProviders.test.ts:799`.
- Descriptor dát: Rust číta `composer.json` - `src-tauri/src/composer.rs:13`; napĺňa `PhpProjectDescriptor.packages/packageName` - `workspace.ts:80`.
- Aktivačné memá v controlleri: `activePhpFrameworkProviders` - `useWorkbenchController.ts:1141`; `isLaravelFrameworkActive` - `:1149`.

### 3.3 Hĺbka zapletenia (kľúčové pre refaktor)
- Provider abstrakcia dnes pokrýva ~20 % Laravel logiky (semantic engine + diagnostic magic). Konzumenti: `phpSemanticEngine.ts`, `phpLanguageServerDiagnosticFilters.ts`.
- Zvyšných ~80 % (routes, config, translations, views, validation, celý Blade tooling) je hardcoded v `useWorkbenchController.ts` za jedným `isLaravelFrameworkActive` boolean-om (**~171 gate-ov**, ~26 priamych importov).
- `phpSemanticEngine.ts` obchádza provider a priamo importuje `phpLaravelContainerBindingsFromSource`/`phpLaravelContainerExpressionClassName` (`:33-34`) + hardcoded `phpFrameworkOwnedMethodReturnNames = new Set(["findOrFail"])` (`:111`).

### 3.4 Izolačný vzor
- Aktívny root: `workspaceRoot` state + live ref `currentWorkspaceRootRef` (`useWorkbenchController.ts:1696`); porovnanie `workspaceRootKeysEqual` (`src/domain/workspaceRootKey.ts:18`).
- Vzor "capture requestedRoot + re-check `currentWorkspaceRootRef` po každom await → drop-stale". Kanonicky `:5789-5896`.

### 3.5 Blade vrstva (predloha pre Latte)
- `.blade.php` → language id v `detectLanguage` - `workspace.ts:287`.
- Highlighting: Shiki `blade` grammar - `shikiHighlighter.ts:305/393`; register `["php","blade"]` - `:578`.
- Monaco providers pre `"blade"` - `languageServerMonacoProviders.ts:919` (definition `:920`, completion `:932` trigger `["@","'","\"","-",".","$",">"]`, code action `:938`).
- Navigácia: `bladeNavigation.ts` (`detectBladeReferenceAt` `:204`, direktívy `:69/221`, komponenty `:253/485`).
- Premenné z controllera: `bladeViewVariables.ts` (`:176/227/245`), zdroj `phpLaravelViewData.ts` (`viewCallSpans` `:96`), path mapping `laravelPathResolution.ts` (`:108`), search queries `BLADE_VIEW_DATA_SEARCH_QUERIES` - `useWorkbenchController.ts:32434`.
- PHP member completion v Blade (`$var->`): `bladePhpMemberAccessCompletionAt` - `useWorkbenchController.ts:32623` (engine-agnostic).
- View-data vrstva je gated `isLaravelFrameworkActive` - `useWorkbenchController.ts:21660`.

## 4. Architektúra (cieľový stav)

### 4.1 Framework profil (agnostic core)
Nový odvodený koncept: **`FrameworkProfile = "laravel" | "nette" | "generic"`**, exkluzívny per-workspace.
- `activeFrameworkProfile` memo z `workspaceDescriptor.php` (composer packages). Presné poradie: Laravel signál → `"laravel"`; Nette signál (`nette/application` | `latte/latte`) → `"nette"`; inak `"generic"`.
- Exkluzivita padá z dát (projekt má typicky len jeden z týchto balíkov). Edge (oba balíky) → deterministické poradie + `log()` do runtime diagnostiky (nedeterministicky nikdy nehádať oba).
- Zachovať `activePhpFrameworkProviders` ako zoznam aktívnych providerov (pre budúcu koexistenciu kapabilít), ale profil je jednoznačný diskriminátor pre UI/izolačné rozhodnutia.

### 4.2 Rozšírený `PhpFrameworkProvider` interface
Pridať kapability, ktoré sú dnes hardcoded (voliteľné metódy - provider implementuje len relevantné):
- `routes` (named routes, `route()` completion + nav)
- `config` (config kľúče + nav)
- `translations` (`__()`/`trans()` + lang súbory)
- `views` / `templating` (view/template name ↔ súbor, direktíva/tag nav, view-data extrakcia)
- `validation`
- `navigation` (string-literal → cieľ Cmd+B)
- `stringLiterals` (klasifikácia string literálu na route/config/view/lang pre nav + diagnostiku)
- `viewData` (controller/presenter → template premenné)

Dispatcher funkcie (`phpFramework*FromSource` v `phpFrameworkProviders.ts:250+`) sa rozšíria o tieto kapability; `useWorkbenchController.ts` volá dispatcher namiesto priamych `isLaravelFrameworkActive` vetiev.

Refaktor je **behavior-preserving**: `phpLaravelFrameworkProvider` obalí existujúce `phpLaravel*` funkcie tak, aby výstup pre Laravel projekt bol identický. Regresná poistka = zelená test suita.

### 4.3 Nette provider
`phpNetteFrameworkProvider` (`id: "nette"`):
- `appliesTo(php)` = composer obsahuje `nette/application` alebo `latte/latte`.
- Fáza 1 implementuje: `templating` (Latte path mapping, tag nav), `viewData` (presenter → template premenné). Ostatné kapability (routes/config/DI) = Fáza 2+ (zatiaľ neimplementované → provider ich nedeklaruje → generický fallback).

### 4.4 Latte templating vrstva
Nové domain moduly (zrkadlo Blade, pure/filesystem-free):
- `latteNavigation.ts` - detekcia Latte konštruktov: `{include}`, `{layout}`/`{extends}`, `{import}`, `{sandbox}`, `{control}`, `{block}`. `LATTE_TAGS` namiesto `BLADE_DIRECTIVES`. Completion názvov + Cmd+B (path mapping cez Nette provider).
- `latteSyntax.ts` - echo/tag/n:attribute parsing: `{$var}`, `{= expr}`, `{foreach $x as $i}...{/foreach}`, `n:if`/`n:foreach`/`n:class`, `{var $x = ...}`. **Hang-safe** (bounded advance; poučenie z opraveného Blade infinite loopu - žiadny `lastIndexOf` clamping, žiadny match presahujúci limit).
- `latteViewVariables.ts` - premenné dostupné v `.latte` (reuse jadra `bladeViewVariables`: merge sightings, konfliktná konzervatívnosť = `null`, type inference cez PHP semantic engine).
- Presenter data extractor (analóg `phpLaravelViewData`) - premenné z `$this->template->x = ...`, `$this->template->setParameters([...])`, `$template->setParameters([...])`; template path mapping podľa Nette konvencie (`app/Presenters/<Name>Presenter.php` render → `templates/<Name>/<action>.latte`, resp. `app/UI/<Name>/`).

Infra rozšírenia (existujúce súbory, len pridať `.latte`/`"latte"`):
- `detectLanguage` (`workspace.ts:287`) → `.latte` → `"latte"`.
- Shiki: `SHIKI_LANGS` + `import("shiki/langs/latte.mjs")` (`shikiHighlighter.ts:305/393`), register loop `["php","blade","latte"]` (`:578`).
- Emmet `HTML_LANGUAGES` (`emmetSetup.ts:14`), Settings jazyk zoznam (`SettingsDialog.tsx:1352`), indent (`EditorSurface.tsx:3711`).
- Monaco providers pre `"latte"` - nový blok v `languageServerMonacoProviders.ts` (~`:919`), trigger chars `["{","$","-",">",".","'","\""]`; refs v `EditorSurface.tsx` (`latteCompletionsRef`/`latteDefinitionRef`/`latteCodeActionsRef`).
- PHP member completion v Latte (`{$var->}`) - reuse `bladePhpMemberAccessCompletionAt` s Latte echo/tag masking.

### 4.5 Vrstvenie (Fleet model) - light mode izolovaný
Dva ortogonálne rozmery. Explicitne dokumentované, aby refaktor light paritu nezmenil:

| Vrstva | Kedy | Výsledok | Analógia |
|---|---|---|---|
| Latte highlighting (Shiki) | vždy (aj `basic`) | zafarbený `.latte`, žiadny backend | Fleet editor mode / VS Code |
| Latte semantic (completion, Cmd+B, premenné) | len `fullSmart` + Nette profil | plná inteligencia | Fleet smart mode / PhpStorm |

- JS/TS light mode (tsserver) = oddelená vetva, 0 zmien.
- Generický PHP = basic phpactor, 0 zmien.
- Latte semantic sa gate-uje cez profil + `fullSmart` (analóg dnešného `isLaravelFrameworkActive` gate pre Blade).

## 5. Dekompozícia do slices

Každý slice: TDD (RED first) → nezávislý adversarial review (iný agent než implementer; eskalovaný pri parser/async/izolácia zmenách) → fix → commit + push na `main`. Poradie rešpektuje závislosti.

**Slice 1 - Framework profil + Nette provider skeleton**
- `activeFrameworkProfile` memo (`Laravel|Nette|Generic`) + exkluzivita + edge log.
- `phpNetteFrameworkProvider` skeleton s `appliesTo` (composer `nette/application`/`latte/latte`); pridať do registry.
- Write-scope: `phpFrameworkProviders.ts`, `useWorkbenchController.ts` (memo), testy.
- Verify: Nette fixture → profil `nette`, Laravel provider `appliesTo` = false; Laravel fixture nezmenený.

**Slice 2 - Framework-agnostic gating refaktor** (najrizikovejší; rozdelený na behavior-preserving pod-slices, každý s plným behom suity)
- 2a: rozšíriť `PhpFrameworkProvider` interface + dispatcher (routes).
- 2b: config. 2c: translations. 2d: views/templating + viewData. 2e: validation. 2f: navigation + stringLiterals.
- Každá pod-slice: presun príslušných `isLaravelFrameworkActive` gate-ov na `provider.capability?.()`; Laravel provider obalí existujúce funkcie; **žiadna zmena správania pre Laravel** (regresný beh suity je akceptačné kritérium).
- Vyčistiť `phpSemanticEngine.ts` priame Laravel importy (`:33-34`) + `"findOrFail"` set (`:111`) do providera.
- Write-scope: `phpFrameworkProviders.ts`, `phpSemanticEngine.ts`, `useWorkbenchController.ts`, príslušné `phpLaravel*` (len obalenie), testy.
- **Povinný adversarial review na každej pod-slice** (blast radius, corruption/regres riziko).

**Slice 3 - `.latte` jazyk + highlighting**
- `detectLanguage`, Shiki latte grammar, Monaco language config, emmet, settings, indent.
- Beží vo všetkých módoch (highlighting tier). Nezávislé od Slice 2.
- Verify: `.latte` súbor → jazyk `latte`, syntax zafarbený; žiadny dopad na blade/php.

**Slice 4 - Latte Monaco providers + navigácia**
- `latteNavigation.ts` (`{include}`/`{layout}`/`{extends}`/`{import}` completion + Cmd+B), Monaco wiring, refs.
- Path mapping cez Nette provider `templating`.
- Verify: `{include 'x'}` → completion + Cmd+B na `.latte`; gated `fullSmart`+Nette.

**Slice 5 - Latte echo/tag parsing + PHP member completion**
- `latteSyntax.ts` (`{$var}`, `{foreach}`, `n:attributes`), `{$var->}` member completion (reuse engine-agnostic).
- Hang-safety adversarial sweep (edge: nested tags, malformed, veľké súbory, self-ref).
- Verify: `{$var->}` → members; `{foreach}` loop var; plain text `>` → žiadny spam.

**Slice 6 - Presenter → template variable resolution**
- Presenter data extractor (`$this->template->x`, `setParameters`), Nette path mapping, `latteViewVariables.ts`.
- Reuse `bladeViewVariables` jadra + izolačný vzor (capture root + re-check po await).
- Verify: presenter posiela `$this->template->invoice = $invoice` → v `.latte` `{$invoice->}` členy modelu.

## 6. Izolácia a riziká

- **Per-workspace exkluzivita**: Nette projekt = žiadny Laravel/Blade a naopak (padá z `activeFrameworkProfile`). To je jadro požiadavky.
- **Behavior-preserving refaktor**: Laravel/light správanie sa nesmie zmeniť. Poistky: (1) 4205+ existujúcich testov zelených po každej pod-slice; (2) adversarial review každého gate-presunu; (3) malé inkrementálne pod-slices, nie big-bang.
- **Izolácia v novom async kóde**: každý Latte async resolver zachytí `requestedRoot` + re-check `currentWorkspaceRootRef` po každom await → drop-stale. Žiadny leak medzi tabmi (completion/nav/diagnostics/cache).
- **Hang-safety**: Latte parsery bounded advance; reprodukčný edge sweep (nested, malformed, heredoc-analóg, veľké súbory). Poučenie z opraveného Blade infinite loopu.
- **Cache invalidácia**: per-root Latte cache (view-data, template mapping) invalidovaná pri zmene/pridaní/zmazaní súboru, ako Blade.

## 7. Testing stratégia

- TDD per slice (RED first), guard clauses / žiadny `else`, SOLID.
- Refaktor (Slice 2): existujúce Laravel testy = regresná poistka; pridať provider-dispatch testy.
- Nové Nette/Latte testy proti **fixtúram**: minimálny Nette projekt (presenter + `.latte` + `composer.json` s `nette/application`).
- Reálne dependencie (žiadny mock interných kolaborátorov); pure domain parsery testovateľné bez FS.
- End-to-end QA na reálnom Nette projekte = follow-up (potrebný reálny projekt; inak fixture-based).

## 8. Latte / Nette konvencie (referencia)

- Latte echo: `{$var}`, `{$var|filter}`, `{= expr}`. Blok: `{foreach $items as $item}...{/foreach}`, `{if}...{/if}`, `{block name}...{/block}`.
- Dedičnosť/include: `{layout 'file.latte'}` / `{extends}`, `{include 'file.latte'}`, `{import}`, `{embed}`.
- n:attributes: `n:if`, `n:foreach`, `n:class`, `n:href`, `n:inner-foreach`.
- Premenné: `{var $x = ...}`; z presenteru `$this->template->x = ...`, `$this->template->setParameters([...])`.
- Presenter → template: `app/Presenters/<Name>Presenter.php` (`renderDefault`, `actionDefault`) → `templates/<Name>/<action>.latte` (staršia konvencia) alebo `app/UI/<Name>/` (moderná). Detekcia oboch konvencií.
- Súbory `.latte`. Composer signál: `nette/application`, `latte/latte`.

## 9. Mimo rozsahu (neskoršie fázy)

- **Fáza 2 - Nette PHP semantic**: presenter konvencie (`action*`/`render*`/`handle*`/`createComponent*`), DI container autowiring, service lookup.
- **Fáza 3 - NEON config**: `config/*.neon`, `services.neon`, parameters resolution, `%param%` completion/nav.
- **Fáza 4 - Symfony provider** (provider interface je pripravený).
- Manuálny framework override v Runtime paneli (ak sa auto-detekcia ukáže nedostatočná).

## 10. Otvorené otázky

- Reálny Nette/Latte projekt pre end-to-end QA (default: fixtúry v testoch).
- Latte 2 vs Latte 3 syntax rozdiely (default: Latte 3; Latte 2 `{block}` varianty tolerovať kde lacné).
- Presenter konvencia: podporiť staršiu (`templates/`) aj modernú (`app/UI/`) - default oboje.
