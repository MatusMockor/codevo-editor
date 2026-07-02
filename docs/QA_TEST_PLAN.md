# Codevo Editor - QA Test Plán (aktuálny)

## Predpoklady (DÔLEŽITÉ)
- [ ] **Čerstvý build** - `npm run debug` (NIE starý `.app` bundle)
- [ ] Reálny Laravel projekt (napr. `kontentino/api`) + nejaký JS/TS projekt
- [ ] Pre Blade komponenty (sekcia 2): kontentino `<x-` komponenty nepoužíva - otestuj na Laravel projekte s `resources/views/components` / `app/View/Components`, alebo si vytvor 2-3 testovacie komponenty
- [ ] Otestovať vo viacerých témach (Dark, Light, Dracula, One Dark Pro)
- [ ] Pri každom bode zapíš OK / CHYBA (+ kroky/screenshot pri chybe)
- Pozn.: **Vue/Nuxt je mimo scope**.
- 💡 Pri akejkoľvek chybe v PHP/JS inteligencii otvor **Runtime panel (Cmd+Shift+R)** → **„Copy debug bundle"** a priloz ho k reportu.
- ℹ️ PHP correctness matica (23 scenárov), runtime chaos testy a Blade domain testy bežia **automaticky v suite** - manuálne stačí spot-check.

---

## 1. PHP / Laravel completions
- [ ] `$model->` ponúkne fillable, casts, **DB stĺpce z migrácií**, relations, scopes - s typmi
- [ ] **Kategórie vizuálne oddelené farbou ikony** (property / relation / method / scope / magic-where) + tichý label; naše návrhy **vyššie než phpactor**
- [ ] `Model::` (static) rovnaké kategórie; **macros z providerov** (`Builder::macro` - aj Query Builder / Collection / Model). *Known gap: macro nie na holom `$model->`, len na `Model::query()->` - nereportovať*
- [ ] **Chain**: `$repo->find()->` → model (aj `*RepositoryContract`); `UserResource::make($m)->response()` → JsonResponse; `Model::query()->where()->first()->` → model
- [ ] **Container binding**: `app()->make(FooInterface::class)->` → concrete; `Model::with('` → relácie

## 2. Blade - komponenty (NOVÉ)
- [ ] **Cmd+B na `<x-invoice.card />`** → otvorí `resources/views/components/invoice/card.blade.php`; funguje aj na closing tagu a s atribútmi
- [ ] Ak existuje **class-based komponent** (`app/View/Components/Alert.php`) → Cmd+B preferuje **triedu** (PhpStorm správanie); `index.blade.php` variant tiež funguje
- [ ] **Kebab-case**: `<x-user-profile>` → `UserProfile.php` / `user-profile.blade.php`
- [ ] **Completion**: napíš `<x-` → hneď sa zobrazí zoznam všetkých komponentov projektu (anonymné aj class-based); filtruje sa pri písaní vrátane `<x-forms.`
- [ ] Pridaj/zmaž/premenuj komponent → completion sa hneď aktualizuje (žiadny stale zoznam)
- [ ] `@component('mail::button')` package syntax → žiadna falošná nav/completion

## 3. Blade - premenné z controllera (NOVÉ - veľký PhpStorm rozdiel)
- [ ] Controller: `return view('invoices.show', ['invoice' => $invoice])` → v `resources/views/invoices/show.blade.php` napíš `$invoice->` → ponúkne **model attributes, relations, methods** (ako v PHP)
- [ ] Funguje aj v `{{ $invoice-> }}` interpolácii
- [ ] Funguje aj pre `compact('invoice')`, `->with('invoice', $invoice)`, `$viewVariables['invoice'] = $invoice;` idiom
- [ ] **Route-model binding**: `public function show(Invoice $invoice)` → typ sa odvodí
- [ ] **Cmd+click na `$invoice->member`** v Blade → skočí na deklaráciu
- [ ] Ak 2 controllery posielajú do tej istej view RÔZNE typy pre tú istú premennú → **žiadne completions** (žiadne hádanie - správne)
- [ ] Zmena controllera (pridaná premenná) → completions sa aktualizujú

## 4. Blade - helpery (NOVÉ)
- [ ] V Blade: `{{ route('` → completion route names; `config('` → config kľúče; `__('` / `trans('` → translation kľúče
- [ ] Funguje aj vnorené v HTML atribúte: `href="{{ route('...') }}"` (predtým skryto zlyhávalo)
- [ ] Funguje aj v direktívach: `@if(config('...'))`
- [ ] **Cmd+B**: `route('name')` → route definícia; `config('app.name')` → config súbor; `__('messages.x')` → lang súbor
- [ ] Dynamické kľúče (`route($var)`) → žiadna falošná diagnostika/completion
- [ ] **Blade súbor začínajúci `{{ ... }}`** + písanie/klikanie inde v súbore → žiadny freeze (regresný test na opravený infinite loop)

## 5. PHP code actions (Alt+Enter / Cmd+.)
- [ ] Najrelevantnejšia prvá; skupiny Quick Fix / Refactor + ikony
- [ ] Create class / method / property z usage (`$this->`, `self::`, `parent::`, typed property)
- [ ] Add return type / type hint, Extract interface (na disk + `use` + `implements`), Implement/Override, Optimize imports

## 6. PHP navigácia (Cmd+B, Cmd+click)
- [ ] Cmd+click = Cmd+B; **Cmd+hover bez kliku NEnaviguje** (regresia)
- [ ] Trait / interface / `parent::` / `self::`/`static::` / scope / relation; Laravel route / model / blade view / config-env

## 7. PHP diagnostiky
- [ ] Reálna chyba → **error**; Laravel magic → **jemný hint** `laravel-magic`; parse-šum → skrytý
- [ ] Inspekcie bez false poplachov (string/`compact()`/`&$x`/closure); container chain OK; stale hover sa zavrie

## 8. Vzhľad (JetBrains klasik) - VO VIAC TÉMACH
- [ ] Cmd+R (kind-ikony + visibility + signatúra, zaoblený výber), Cmd+., autocomplete/hover/pravý klik, palety (accent-bar, footer hinty)

## 9. Find / Replace / Search
- [ ] Quick Open / Search Everywhere: **match highlighting** + instant; Replace in files (konfirmácia, `$1` capture)

## 10. Light mode
- [ ] PHP/Laravel Cmd+B **INSTANTNÝ**

## 11. Git workflow + Local Changes
- [ ] Status ikony + počet zmien; per-hunk stage (edge cases); rollback popover (Revert/Prev/Next); Alt+F5/Shift+Alt+F5; commit Cmd+Enter; stash/branch/history/blame skratky

## 12. Status bar
- [ ] Ln/Col (klik → Go to Line), git branch, **transient správy zmiznú po ~5s**, pravý klik toggle

## 13. Command palette / keymap
- [ ] Cmd+Shift+P nav + empty state; keymap search + **key-capture** + **conflict warning**; F2 rename; fold skratky

## 14. JSON schema + EditorConfig
- [ ] `.phpactor.json` bez „768" vlnovky; `.editorconfig` indent/EOL/trim

## 15. JS/TS (VS Code parity)
- [ ] Nav/rename/references/hover/completion; **auto-import**; quick fixes; diagnostiky refresh; bez tsconfig OK

## 16. Runtime diagnostic cockpit (Cmd+Shift+R)
- [ ] PID / stav / RAM / CPU / crash reason; Restart / Stop / Log
- [ ] Recent LSP requests s latenciami; stderr tail inline; **Operation latency** (median/p95 + health dot); **Copy debug bundle**
- [ ] Pri 2 projektoch ukazuje aktívny (žiadny leak)

## 17. Index progress
- [ ] Cold index → „Indexing X of N (P%)" (nie hang spinner)

## 18. Per-project izolácia (KRITICKÉ - 2 projekty v taboch)
- [ ] Diagnostiky / completions / nav / observability / latencie / index progress / **Blade cache (komponenty, view premenné)** NEpretekajú medzi projektmi
- [ ] Prepínanie tabov → všetko patrí aktívnemu projektu

## 19. Runtime lifecycle / stabilita
- [ ] IDE on/off → phpactor start/stop; close project → LSP stop; quit → všetko stop (Runtime panel + Activity Monitor)
- [ ] Spot-check: ručný kill phpactora → editor zvládne; rýchle IDE mode prepínanie → žiadne visiace procesy
- [ ] Žiadne falošné toasty (Something went wrong / UnknownDocument) po zatvorení/rename/delete tabu
- [ ] Delete/rename súboru s chybami → diagnostiky sa vyčistia

## 20. Regresie
- [ ] Quick-open nového PHP súboru s obsahom; phpactor cez `codevo-php.ini`; git diff nie blank; Canceled/ResizeObserver nie sú error notice

---

### Priorita testovania (ak je málo času)
1. **18 + 19** (izolácia + lifecycle) + **16** (cockpit)
2. **2 + 3 + 4** (NOVÉ Blade - komponenty, premenné, helpery + freeze regresia)
3. **6** (Cmd-hover regresia) + **8** (vzhľad naprieč témami)
4. **1** (completions + chain) + **5 + 7** (actions + diagnostiky) + zvyšok
