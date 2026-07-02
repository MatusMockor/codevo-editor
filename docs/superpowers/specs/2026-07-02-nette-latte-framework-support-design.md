# Nette + Latte Framework Support - Design (Fáza 1)

Dátum: 2026-07-02 (rev. 2026-07-03 - doplnené detaily z histórie požiadavky)
Stav: Design (pred implementačným plánom)
Rozsah: Fáza 1 - framework-profil detekcia + framework-agnostic gating refaktor + Latte templating (FE) + NEON config základ

## 1. Cieľ

Pridať do Codevo Editora podporu pre **Nette** (PHP framework), jeho šablónovací engine **Latte** (obdoba Blade) a ich **NEON config** (`config.neon`, `services.neon` - súčasť pôvodnej požiadavky: "config ako oni používajú"), s **per-workspace prepínaním**: keď IDE mode v otvorenom projekte zistí Nette, Laravel "magic" + Blade sa preň **nezapnú** (a naopak). Existujúci light mode (JS/TS, VS Code parity) a Laravel IDE mode (PhpStorm parity) sa správaním **nesmú zmeniť**.

Fáza 1 pokrýva:
1. Framework-profil detekciu (`Laravel | Nette | Generic`) z `composer.json`, per-workspace, exkluzívnu.
2. Plný framework-agnostic refaktor gating vrstvy (dnes hardcoded `isLaravelFrameworkActive` na ~171 miestach) na provider-driven dispatch.
3. Latte templating FE: `.latte` jazyk + highlighting, `{$var}` echo / `{foreach}` / `n:attributes`, `{include}`/`{layout}`/`{extends}`/`{block}` completion + Cmd+B, premenné z presenteru (`$this->template->x`) + `{varType}`/`{parameters}` deklarácie.
4. `{link}` / `n:href` → presenter:action navigácia + completion (signature Nette feature).
5. NEON config základ: `.neon` jazyk + highlighting + navigácia na service triedy.

**Mimo rozsahu Fázy 1** (samostatné neskoršie fázy, detaily v §9): hlboký Nette PHP semantic (DI autowiring cez NEON, presenter lifecycle, `createComponent*` factory), NEON parameters resolution (`%param%`), Symfony provider.

## 2. Kontext požiadavky a rozhodnutia z brainstormingu

**História zámeru**: plugin systém `PhpFrameworkProvider` (registry + `appliesTo`) bol postavený v "completion v2" slici explicitne so zámerom "Laravel teraz, neskôr Nette/Symfony" (požiadavka usera). Táto fáza ten seam napĺňa. Pôvodná požiadavka pre túto fázu znie: podpora Nette + "lette fe co je ako v laraveli blade" (Latte) + "config ako oni pouzivaju" (NEON) + exkluzivita per otvorený workspace.

- **Detekcia frameworku**: auto z `composer.json`. `laravel/framework` → Laravel; `nette/application` alebo `latte/latte` → Nette; inak Generic (phpactor only). Bez manuálneho override (Fáza 1).
- **Gating stratégia**: plný framework-agnostic refaktor. Rozšíriť `PhpFrameworkProvider` interface o chýbajúce kapability a presunúť ~171 `isLaravelFrameworkActive` gate-ov na provider dispatch. **Behavior-preserving pre Laravel** - existujúca test suita (4205+ testov) je regresná poistka.
- **Vrstvenie (Fleet model)**: highlighting tier beží vždy (aj `basic`/light), semantic tier len vo `fullSmart` + príslušný framework profil. JS/TS light mode je oddelená vetva - nedotýkame sa jej.
- **Verify**: Fáza 1 sa overuje fixtúrami (testovací Nette/Latte fixture: presenter + `.latte` + `.neon` + `composer.json`). End-to-end QA na reálnom Nette projekte je follow-up (vyžaduje reálny projekt).

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

### 3.6 Shiki grammars (OVERENÉ - dôležitá korekcia)
- Shiki bundle **NEOBSAHUJE** `latte` ani `neon` grammar (overené v `node_modules/@shikijs/langs/dist` - je tam len `blade`).
- Dôsledok: Latte + NEON highlighting vyžaduje **vlastnú/vendorovanú TextMate grammar** registrovanú ako custom lang objekt (Shiki `createHighlighter` custom langs podporuje). Zdroj: MIT-licencovaná grammar z Nette/Latte VS Code extension ekosystému, alebo vlastná minimálna grammar (Latte = HTML báza + `{...}` tagy + `n:` atribúty; NEON = YAML-like). Licenciu overiť pred vendorovaním; fallback = vlastná grammar.

## 4. Architektúra (cieľový stav)

### 4.1 Framework profil (agnostic core)
Nový odvodený koncept: **`FrameworkProfile = "laravel" | "nette" | "generic"`**, exkluzívny per-workspace.
- `activeFrameworkProfile` memo z `workspaceDescriptor.php` (composer packages). Presné poradie: Laravel signál → `"laravel"`; Nette signál (`nette/application` | `latte/latte`) → `"nette"`; inak `"generic"`.
- Exkluzivita padá z dát (projekt má typicky len jeden z týchto balíkov). Edge (oba balíky) → deterministické poradie + log do runtime diagnostiky (nikdy nehádať oba naraz).
- **Dôsledky exkluzivity (explicitne)**: v Nette projekte sa neaktivuje Blade semantic (aj keby tam ležal `.blade.php` súbor), Laravel helpery, Laravel view-data vrstva ani laravel-magic diagnostic downgrade. V Laravel projekte sa neaktivuje Latte semantic, Nette view-data ani Nette magic suppression. Highlighting tier (čisté farbenie) beží pre oba typy súborov vždy - je neškodný a bez backendu.
- Zachovať `activePhpFrameworkProviders` ako zoznam aktívnych providerov; profil je jednoznačný diskriminátor pre UI/izolačné rozhodnutia (napr. status bar chip "IDE: PHPactor · Laravel" / "· Nette").

### 4.2 Rozšírený `PhpFrameworkProvider` interface
Pridať kapability, ktoré sú dnes hardcoded (voliteľné metódy - provider implementuje len relevantné):
- `routes` (named routes/linky, completion + nav)
- `config` (config kľúče/súbory + nav)
- `translations` (`__()`/`trans()` + lang súbory)
- `views` / `templating` (template name ↔ súbor, direktíva/tag nav, template-data extrakcia)
- `validation`
- `navigation` (string-literal → cieľ Cmd+B)
- `stringLiterals` (klasifikácia string literálu na route/config/view/lang pre nav + diagnostiku)
- `viewData` (controller/presenter → template premenné)
- `diagnostics` (už existuje: known member/static method - rozšíriť pre Nette magic, viď 4.6)

Dispatcher funkcie (`phpFramework*FromSource` v `phpFrameworkProviders.ts:250+`) sa rozšíria o tieto kapability; `useWorkbenchController.ts` volá dispatcher namiesto priamych `isLaravelFrameworkActive` vetiev.

Refaktor je **behavior-preserving**: `phpLaravelFrameworkProvider` obalí existujúce `phpLaravel*` funkcie tak, aby výstup pre Laravel projekt bol identický. Regresná poistka = zelená test suita.

### 4.3 Nette provider
`phpNetteFrameworkProvider` (`id: "nette"`):
- `appliesTo(php)` = composer obsahuje `nette/application` alebo `latte/latte`.
- Fáza 1 implementuje: `templating` (Latte path mapping, tag nav), `viewData` (presenter → template premenné), `routes` v Nette zmysle (`{link}`/`n:href` presenter:action ciele), `diagnostics` (Nette magic suppression - 4.6), `config` základ (NEON súbory + service triedy nav).
- Ostatné kapability (validation, translations - Nette `Translator`) = Fáza 2+ (provider ich nedeklaruje → generický fallback).

### 4.4 Latte templating vrstva
Nové domain moduly (zrkadlo Blade, pure/filesystem-free):
- `latteNavigation.ts` - detekcia Latte konštruktov: `{include 'file.latte'}` (aj `{include block}` - rozlíšiť blok vs súbor), `{layout}`/`{extends}`, `{import}`, `{embed}`, `{sandbox}`, `{control name}`, `{block name}`/`{define name}`. `LATTE_TAGS` zoznam (obdoba `BLADE_DIRECTIVES`). Completion názvov + Cmd+B (path mapping cez Nette provider). **`@layout.latte` auto-lookup konvencia** (layout sa hľadá aj bez explicitného `{layout}` - `@layout.latte` v adresári template / rodičovských).
- `latteSyntax.ts` - echo/tag/n:attribute parsing: `{$var}`, `{$var|filter|another}` (filter chain masking), `{= expr}`, `{foreach $x as $i}...{/foreach}` (+ `{forelse}` neexistuje - Latte má `{else}` vetvu vo foreach; parsovať korektne), `n:if`/`n:foreach`/`n:inner-foreach`/`n:class`/`n:attr`, `{var $x = ...}`, `{default $x = ...}`, `{capture $x}`. **Escapovanie: `{l}`/`{r}` literálne zátvorky, `{* komentár *}`, `{syntax off}` bloky, JS/CSS kontext v `<script>`/`<style>` (Latte tam tagy neparsuje s výnimkou n:attributov)** - parser musí tieto masky rešpektovať, inak false detekcie. **Hang-safe** (bounded advance; poučenie z opraveného Blade infinite loopu - žiadny `lastIndexOf` clamping, žiadny match presahujúci limit).
- `latteViewVariables.ts` - premenné dostupné v `.latte`. Zdroje typov v poradí spoľahlivosti:
  1. **`{varType App\Model\Product $product}`** deklarácie priamo v template (deterministický, PhpStorm/Latte plugin štandard) a **`{parameters App\Model\Product $product}`** (Latte 3 typed parameters) - najvyššia priorita.
  2. `{var $x = expr}` / `{default $x = expr}` lokálne premenné (expression type inference).
  3. Presenter `$this->template->x = ...` / `setParameters([...])` (viď 4.5).
  4. `{foreach}` loop premenné (element typ z kolekcie, vrátane relation chainov - reuse prístupu z Blade nested foreach).
  Reuse jadra `bladeViewVariables`: merge sightings, konfliktná konzervatívnosť (= `null`), type inference cez PHP semantic engine.
- Presenter data extractor (analóg `phpLaravelViewData`) - premenné z `$this->template->x = ...`, `$this->template->setParameters([...])`, `$template->x = ...` (render metóda dostáva `$template`); search queries: `->template->`, `setParameters(`.

Infra rozšírenia (existujúce súbory, len pridať `.latte`/`"latte"`):
- `detectLanguage` (`workspace.ts:287`) → `.latte` → `"latte"`.
- Shiki: custom Latte grammar (vendored/vlastná - viď 3.6) + `SHIKI_LANGS` + register loop (`shikiHighlighter.ts:578`).
- Emmet `HTML_LANGUAGES` (`emmetSetup.ts:14`), Settings jazyk zoznam (`SettingsDialog.tsx:1352`), indent (`EditorSurface.tsx:3711`).
- Monaco providers pre `"latte"` - nový blok v `languageServerMonacoProviders.ts` (~`:919`), trigger chars `["{","$","-",">",".","'","\"","|",":"]`; refs v `EditorSurface.tsx`.
- PHP member completion v Latte (`{$var->}`) - reuse `bladePhpMemberAccessCompletionAt` prístupu s Latte echo/tag masking.
- Completion built-in filtrov za `|` (upper, lower, date, number, truncate, ...) - konzervatívny statický zoznam Latte 3 filtrov.

### 4.5 Presenter ↔ template mapping (obe konvencie)
Nette má dve živé štruktúry - podporiť obe, detekovať podľa reálnej polohy súborov:
1. **Staršia**: `app/Presenters/ProductPresenter.php` + `app/Presenters/templates/Product/show.latte` (+ `templates/@layout.latte`).
2. **Moderná (nette/web-project 3.2+)**: `app/UI/Product/ProductPresenter.php` + `app/UI/Product/show.latte` (template **vedľa** presenteru; aj `ProductTemplate.php` triedy).
- Mapping presenter action/render metóda ↔ template: `renderShow`/`actionShow` ↔ `show.latte`; default `default.latte`.
- Custom Template triedy (`ProductTemplate extends Nette\Bridges\ApplicationLatte\Template` s typed properties / `@property` anotáciami) = zdroj typov premenných (ak existuje, preferovaný pred sightings).
- Komponenty/controls: `SomethingControl.php` + `something.latte` vedľa seba + `$this->template->render(__DIR__ . '/something.latte')` - basic nav podpora, hlbšie v Fáze 2.

### 4.6 Nette magic diagnostics (false-positive suppression)
Zrkadlo laravel-magic klasifikácie - v Nette projekte phpactor nesmie hádzať chyby na Nette idiomy:
- `$this->template->anything = ...` / čítanie - dynamické properties na `Nette\Bridges\ApplicationLatte\Template` (magic `__set`/`__get`).
- `Nette\SmartObject` `@property` anotácie (magic accessory).
- `$this->getComponent('x')` / `$this['x']` component access.
- Klasifikácia cez existujúci provider `diagnostics` seam (`isKnownMemberMethod`/`isKnownStaticMethod` + rozšírenie o known-property) → downgrade na `nette-magic` hint (analóg `laravel-magic`), nie error, nie tichý drop.

### 4.7 `{link}` / `n:href` navigácia (signature Nette feature)
- `n:href="Product:show $id"`, `{link Product:show}`, `{plink ...}` v Latte; `$this->link('Product:show')`, `$this->redirect('Product:show')` v PHP presenteroch.
- Completion cieľov `Presenter:action` (z discovered presenterov + ich action/render metód) + Cmd+B na `ProductPresenter::actionShow/renderShow`.
- Relatívne ciele: `show` (rovnaký presenter), `Product:` (default action), `:Admin:Product:show` (absolútny s modulom) - konzervatívne: nejednoznačné → bez navigácie, žiadne hádanie.
- Vyžaduje presenter discovery (per-root cache, invalidácia pri zmene súborov) - zdieľané so 4.5.

### 4.8 NEON config základ
- `.neon` jazyk: `detectLanguage` → `"neon"`, custom grammar (YAML-like; viď 3.6), Monaco language config (komentáre `#`, indent).
- Navigácia: `services:` sekcia - class names (`App\Model\ProductRepository`) a `factory:`/`implement:`/`create:` hodnoty → Cmd+B na PHP triedu; `includes:` → Cmd+B na ďalší `.neon` súbor.
- Completion class names v `services:` kontexte (z workspace indexu) - konzervatívne.
- `%parameters%` resolution, extension konfigy, autowiring semantics = Fáza 2/3 (mimo tejto fázy).

### 4.9 Vrstvenie (Fleet model) - light mode izolovaný
Dva ortogonálne rozmery. Explicitne dokumentované, aby refaktor light paritu nezmenil:

| Vrstva | Kedy | Výsledok | Analógia |
|---|---|---|---|
| Latte/NEON highlighting | vždy (aj `basic`) | zafarbený `.latte`/`.neon`, žiadny backend | Fleet editor mode / VS Code |
| Latte/NEON semantic (completion, Cmd+B, premenné) | len `fullSmart` + Nette profil | plná inteligencia | Fleet smart mode / PhpStorm |

- JS/TS light mode (tsserver) = oddelená vetva, 0 zmien.
- Generický PHP = basic phpactor, 0 zmien.
- Latte/NEON semantic gate-ované cez profil + `fullSmart` (analóg dnešného Blade gate).

## 5. Dekompozícia do slices

Každý slice: TDD (RED first) → nezávislý adversarial review (iný agent než implementer; eskalovaný pri parser/async/izolácia zmenách) → fix → commit + push na `main`. Poradie rešpektuje závislosti.

**Slice 1 - Framework profil + Nette provider skeleton**
- `activeFrameworkProfile` memo (`Laravel|Nette|Generic`) + exkluzivita + edge log; status bar chip doplniť o profil.
- `phpNetteFrameworkProvider` skeleton s `appliesTo`; pridať do registry.
- Verify: Nette fixture → profil `nette`, Laravel `appliesTo` = false; Laravel fixture nezmenený.

**Slice 2 - Framework-agnostic gating refaktor** (najrizikovejší; behavior-preserving pod-slices, každá s plným behom suity + povinným adversarial review)
- 2a: interface + dispatcher (routes). 2b: config. 2c: translations. 2d: views/templating + viewData. 2e: validation. 2f: navigation + stringLiterals.
- Vyčistiť `phpSemanticEngine.ts` priame Laravel importy (`:33-34`) + `"findOrFail"` set (`:111`) do providera.
- Akceptačné kritérium každej pod-slice: žiadna zmena správania pre Laravel (celá suita zelená).

**Slice 3 - `.latte` + `.neon` jazyky + highlighting**
- Vendorovaná/vlastná TextMate grammar pre Latte + NEON (licencia overená), custom lang registrácia v Shiki, `detectLanguage`, Monaco config, emmet (latte), settings, indent.
- Beží vo všetkých módoch (highlighting tier). Nezávislé od Slice 2.
- Verify: `.latte`/`.neon` → správny jazyk + zafarbenie; žiadny dopad na blade/php/yaml.

**Slice 4 - Latte navigácia + Monaco providers**
- `latteNavigation.ts`: `{include}`/`{layout}`/`{extends}`/`{import}`/`{embed}` (súbory), `{block}`/`{define}` (bloky), `@layout.latte` auto-lookup. Monaco wiring + refs.
- Path mapping cez Nette provider `templating` (obe konvencie z 4.5).
- Verify: completion + Cmd+B; gated `fullSmart`+Nette.

**Slice 5 - Latte syntax parsing + PHP member completion**
- `latteSyntax.ts`: `{$var}` echo (+ filter chain), `{foreach}` (+`{else}` vetva), `n:attributes` (vrátane `n:inner-foreach`), masky (`{* *}`, `{l}/{r}`, `{syntax off}`, script/style kontext).
- `{$var->}` member completion (reuse engine-agnostic prístupu), filter completion za `|`.
- Hang-safety adversarial sweep (nested, malformed, veľké súbory, `{syntax off}`, script bloky).
- Verify: `{$var->}` → members; `{foreach}` loop var; plain `{` v JS bloku → žiadny spam.

**Slice 6 - Presenter → template variable resolution + Nette magic diagnostics**
- Presenter data extractor (`$this->template->x`, `setParameters`, `$template->x`), Template triedy (typed props/`@property`), `{varType}`/`{parameters}`/`{var}`/`{default}` deklarácie, `latteViewVariables.ts` (priority z 4.4).
- Nette magic diagnostic suppression (4.6): `template->*`, SmartObject, component access → `nette-magic` hint.
- Izolačný vzor (capture root + re-check po await), per-root cache + invalidácia.
- Verify: `$this->template->invoice = $invoice` → `{$invoice->}` členy; `{varType}` má prednosť; phpactor chyba na `template->x` → hint, nie error.

**Slice 7 - `{link}` / `n:href` presenter:action navigácia**
- Presenter discovery (per-root cache), completion `Presenter:action` cieľov, Cmd+B na action/render metódu; aj PHP strana (`$this->link/redirect`).
- Relatívne/absolútne ciele konzervatívne (4.7).
- Verify: `n:href="Product:show"` → Cmd+B na `ProductPresenter::renderShow`; nejednoznačné → žiadna nav.

**Slice 8 - NEON config základ**
- `.neon` navigácia (service class → PHP trieda, `includes:` → súbor) + class completion v `services:`.
- Verify: Cmd+B zo služby na triedu; gated `fullSmart`+Nette.

## 6. Izolácia a riziká

- **Per-workspace exkluzivita**: Nette projekt = žiadny Laravel/Blade semantic a naopak (padá z `activeFrameworkProfile`; explicitné dôsledky v 4.1). To je jadro požiadavky.
- **Behavior-preserving refaktor**: Laravel/light správanie sa nesmie zmeniť. Poistky: (1) 4205+ existujúcich testov zelených po každej pod-slice; (2) adversarial review každého gate-presunu; (3) malé inkrementálne pod-slices, nie big-bang.
- **Izolácia v novom async kóde**: každý Latte/NEON async resolver zachytí `requestedRoot` + re-check `currentWorkspaceRootRef` po každom await → drop-stale. Žiadny leak medzi tabmi.
- **Hang-safety**: Latte parsery bounded advance; reprodukčný edge sweep. Poučenie z opraveného Blade infinite loopu.
- **Cache invalidácia**: per-root cache (presenter discovery, template mapping, view-data) invalidovaná pri zmene/pridaní/zmazaní súborov, ako Blade.
- **Grammar riziko**: Latte/NEON grammar nie je v Shiki - vendoring/licencia alebo vlastná grammar (3.6). Fallback: minimálna vlastná grammar (nižšia vernosť farbenia, funkčne OK).

## 6b. Performance (merať, nie pocitovo)

Zásady platné pre všetky slices; overované meraním (runtime cockpit už má operation latency median/p95):

- **Provider dispatch bez réžie na keystroke**: refaktor (Slice 2) nesmie pridať merateľnú latenciu do completion/diagnostics hot path. `activePhpFrameworkProviders` je memoizované (existujúca signature cache); dispatch je iterácia 1-2 providerov cez voliteľné metódy - žiadne opakované `appliesTo` vyhodnocovanie per request. Akceptačné kritérium: completion latencia pred/po refaktore bez regresie (porovnať p95 na reálnom Laravel projekte).
- **Lazy, on-demand scanovanie**: presenter discovery, template mapping a NEON služby sa NEskenujú eager pri otvorení projektu - budujú sa pri prvom použití (ako Blade view-data: text-search až na dopyt) a cachujú per-root. Žiadny nový cold-start náklad pri otvorení workspace.
- **Inkrementálna invalidácia**: file-watcher invaliduje len dotknuté cache položky (zmenený presenter → jeho template mapping), nie celý per-root cache; bez re-scan búrok pri hromadných zmenách (git checkout).
- **Parsery na hot path sú pure a bounded**: Latte parsing pri completion pracuje nad aktuálnym dokumentom (string ops, jeden prechod, bounded advance) - žiadne FS/async volania v synchronnej ceste, žiadny full-project parse pri písaní.
- **Highlighting lazy**: Latte/NEON grammar sa načítava dynamickým importom ako ostatné Shiki jazyky (až keď sa prvý taký súbor otvorí) - žiadny nárast startup bundle/času pre ne-Nette používateľov.
- **Pamäť a cleanup**: per-root Nette cache (presentery, mapping, view-data, NEON) sa uvoľňujú pri vypnutí IDE mode / zatvorení projektu - rovnaký lifecycle ako existujúce Blade/index cache (žiadny leak pri prepínaní projektov).
- **Meranie súčasťou QA**: po Slice 2 a po Slice 6/7 zmerať completion latenciu a index/warmup časy na reálnom Laravel projekte (regresia) a Nette fixture (baseline) - profilovať pred akoukoľvek optimalizáciou (žiadne slepé optimalizácie).

## 7. Testing stratégia

- TDD per slice (RED first), guard clauses / žiadny `else`, SOLID.
- Refaktor (Slice 2): existujúce Laravel testy = regresná poistka; pridať provider-dispatch testy.
- Nové Nette/Latte/NEON testy proti **fixtúram**: minimálny Nette projekt v oboch konvenciách (presenter + `.latte` + `.neon` + `composer.json` s `nette/application`); Latte syntax edge fixtures (`{syntax off}`, script bloky, filter chains).
- Reálne dependencie (žiadny mock interných kolaborátorov); pure domain parsery testovateľné bez FS.
- End-to-end QA na reálnom Nette projekte = follow-up (potrebný reálny projekt; inak fixture-based).

## 8. Latte / Nette konvencie (referencia)

- Latte echo: `{$var}`, `{$var|filter|another}`, `{= expr}`. Blok: `{foreach}...{else}...{/foreach}`, `{if}...{elseif}...{/if}`, `{block name}`/`{define name}`, `{capture $x}`.
- Dedičnosť/include: `{layout 'file.latte'}` / `{extends}`, `@layout.latte` auto-lookup, `{include 'file.latte'}` vs `{include blockname}`, `{import}`, `{embed}`, `{sandbox}`.
- n:attributes: `n:if`, `n:foreach`, `n:inner-foreach`, `n:class`, `n:attr`, `n:tag`, `n:href` (linky), `n:name` (formy).
- Typy premenných: `{varType Type $x}`, `{parameters Type $x}` (Latte 3), `{var $x = ...}`, `{default $x = ...}`, `{templateType App\ProductTemplate}`.
- Z presenteru: `$this->template->x = ...`, `$this->template->setParameters([...])`; Template triedy s typed properties.
- Linky: `n:href="Presenter:action args"`, `{link}`, `{plink}`; PHP: `$this->link()`, `$this->redirect()`, `$this->forward()`.
- Masky/escapy: `{* komentár *}`, `{l}`/`{r}`, `{syntax off}...{/syntax}`, `{contentType}`; v `<script>`/`<style>` Latte tagy neparsuje (okrem n:attr na tagu).
- Štruktúry projektu: staršia `app/Presenters/` + `templates/`, moderná `app/UI/<Name>/` (presenter + template vedľa seba). Composer signál: `nette/application`, `latte/latte`.
- NEON: `services:` (class, factory, setup, tags), `parameters:` + `%param%`, `includes:`, `extensions:`; syntax YAML-like s entitami `Class(arg)`.

## 9. Mimo rozsahu (neskoršie fázy)

- **Fáza 2 - Nette PHP semantic**: presenter lifecycle (`action*`/`render*`/`handle*`/`startup`), `createComponent*` factory + `{control x}` ↔ komponent nav, DI container autowiring (constructor/inject), `inject*` metódy, Nette translations (`Translator`), formy (`n:name` ↔ form komponenty).
- **Fáza 3 - NEON semantic**: `%parameters%` resolution + completion, extension konfigy, service reference (`@service`) nav, autowiring diagnostika.
- **Fáza 4 - Symfony provider** (interface pripravený refaktorom).
- Manuálny framework override v Runtime paneli (ak sa auto-detekcia ukáže nedostatočná).

## 10. Otvorené otázky

- Reálny Nette/Latte projekt pre end-to-end QA (default: fixtúry v testoch).
- Latte 2 vs Latte 3 syntax rozdiely (default: Latte 3; Latte 2 varianty tolerovať kde lacné).
- Zdroj TextMate grammar pre Latte/NEON: vendoring existujúcej (licencia!) vs vlastná minimálna (default: overiť existujúce, fallback vlastná).
