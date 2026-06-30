# Codevo Editor - QA Test Plán (aktuálny)

## Predpoklady (DÔLEŽITÉ)
- [ ] **Čerstvý build** - `npm run debug` (NIE starý `.app` bundle)
- [ ] Reálny Laravel projekt (napr. `kontentino/api`) + nejaký JS/TS projekt
- [ ] Otestovať vo viacerých témach (Dark, Light, Dracula, One Dark Pro) - hlavne vzhľad
- [ ] Pri každom bode zapíš OK / CHYBA (+ kroky/screenshot pri chybe)
- Pozn.: **Vue/Nuxt je mimo scope** - netestovať.

---

## 1. PHP / Laravel completions
- [ ] `$model->` na Eloquent modeli ponúkne: **fillable, casts, DB stĺpce z migrácií** (`id`, `created_at`, `updated_at`, aj stĺpce mimo `$fillable`), **relations**, **scopes** - s typmi
- [ ] Completion sú **zoradené po kategóriách**: property → relation → method → scope → **magic-where** (`whereName()`...), každá s odlišnou ikonou
- [ ] Naše Laravel/OOP návrhy sú **vyššie než phpactor** (žiadny šum hore)
- [ ] `Model::` (static) má rovnaké kategórie + ordering ako `$model->`
- [ ] **Macros z providerov**: `Builder::macro('x', ...)` v `app/Providers/*.php` → `x` sa ponúkne na builder receiveri (aj Query Builder / Collection / Model macros)
- [ ] **Chain**: `$model->findOrFail($id)->`, `Model::query()->where(...)->first()->`, `Model::with('rel')->first()->` → ponúkne atribúty cieľového modelu
- [ ] `Model::with('` → ponúkne názvy relácií (string literal)

## 2. PHP code actions (Alt+Enter / Cmd+.)
- [ ] **Poradie**: najrelevantnejšia akcia je **prvá**; kindy vizuálne rozlíšené (žiarovka quick-fix vs kľúč refactor/generate)
- [ ] **Create class** na neznámej triede (`new FooBar()`) → vytvorí PSR-4 súbor + namespace; na existujúcej/built-in sa NEponúkne
- [ ] **Create method/property** z usage: `$this->x()`, `self::x()`/`static::x()` (static), `parent::x()` (same-file), `$this->prop = new Foo()` (typed property)
- [ ] **Add return type** / **Add type hint** (z PHPDoc / typu vrátenej property / defaultu)
- [ ] **Extract interface** → vytvorí `XxxInterface.php` na disku s `use` importmi + `implements`
- [ ] **Implement / Override methods**, **Optimize imports** (zachová použité aj v PHPDoc `@extends`/generics)

## 3. PHP navigácia (Cmd+B, Cmd+click)
- [ ] **Cmd+click = Cmd+B** (skok na definíciu)
- [ ] **REGRESIA**: drž len **Cmd a hýb myšou** nad symbolom (bez kliku) → **NESMIE ťa prehodiť** (a žiadny error toast)
- [ ] Cmd+B na: **trait** metóde, **interface** metóde, **parent::method()**, **self::/static::**, zdedenej `$this->method()`, Laravel **scope**, Laravel **relation** → správny cieľ
- [ ] Laravel route / model (route binding) / blade view / config-env kľúč

## 4. PHP diagnostiky
- [ ] **Klasifikácia**: reálna chyba → **červená (error)**; známa Laravel magic (builder/macro/scope) → **jemný hint** s tagom `laravel-magic` (nie červená, ale ani skrytá); phpactor parse-šum → skrytý
- [ ] **Inspekcie**: nepoužitý `use` import (faded + Remove), nepoužitá private metóda, nepoužitá premenná - ale premenná v stringu `"$x"`/`compact()`/`&$x`/closure `use($x)` → **žiadny** false poplach
- [ ] **Container chain**: `app()->make(X::class)->method()` → žiadne falošné „undefined method" keď metóda existuje
- [ ] Po oprave chyby (diagnostika zmizne) → **stale tooltip/hover sa sám zavrie**

## 5. Vzhľad / redesign (JetBrains klasik) - testuj VO VIAC TÉMACH
- [ ] **Cmd+R (File Structure)**: okrúhle **farebné ikony podľa druhu** + visibility `+/−/#` + signatúra `(params): ReturnType`; vybraný riadok **zaoblený s odsadením** (nie hranatý obdĺžnik)
- [ ] **Cmd+. (code action menu)**: zaoblený, soft-accent výber (nie modrý default)
- [ ] **Autocomplete / hover / pravý klik**: rovnaký štýl, kind farby na ikonách
- [ ] **Palety** (Cmd+P / Cmd+Shift+P / Class Open / Search Everywhere): kompaktné, accent-bar na výbere, footer hinty
- [ ] **Prepni témy** → farby ikon/popupov ladia, nič nečitateľné

## 6. Find / Replace / Search
- [ ] **Find in files** instant aj na veľkom repe; **Replace in files** (replace input + Replace All / Replace in file) s **konfirmáciou** pred Replace All + regex capture (`$1`)
- [ ] **Quick Open (Cmd+P) / Search Everywhere** - instant písanie

## 7. Light mode (Editor Mode / bez IDE)
- [ ] V light mode PHP/Laravel **Cmd+B je INSTANTNÝ** (žiadne 5-10s); nav nie je vypnutá

## 8. Git workflow
- [ ] Diff (nie blank), stage/unstage súbor + per-hunk, revert, commit / commit & push, stash, branch switch/create, file history, blame
- [ ] **Skratky**: stash, switch branch, blame, file history, local history, **commit (Cmd+Enter)** - over že fungujú
- [ ] **Change gutter**: farebné markery + popover „Revert change"; **Alt+F5 / Shift+Alt+F5** skok na ďalšiu/predošlú zmenu v editore
- [ ] Stage tlačidlo má Plus ikonu, labely „Stage/Unstage"

## 9. Status bar (dole)
- [ ] **„Ln X, Col Y"** mení sa pri pohybe kurzora; klik → Go to Line
- [ ] **Git branch** dole; klik → branch panel
- [ ] Bez šumu/blikania; pravý klik → toggle položiek

## 10. Command palette / keymap
- [ ] **Cmd+Shift+P**: šípky ↑↓ (wrap), Enter spustí zvýraznený, prázdny filter → „No matching commands" (nie prázdny panel)
- [ ] **Settings → Keymap**: search box filtruje skratky; rebind funguje
- [ ] **F2 rename** (cross-file), **Cmd+Shift+- / =** fold all / unfold all

## 11. JSON schema
- [ ] `.phpactor.json` (alebo JSON s `$schema`) → **žiadna žltá vlnovka** ani „No schema request service available (768)"

## 12. EditorConfig
- [ ] Projekt s `.editorconfig` → indent (tabs/spaces + veľkosť) a EOL podľa configu; na save trim trailing whitespace + final newline

## 13. JS/TS (Light mode = VS Code parity)
- [ ] Go to definition / implementation / references, rename (F2 cross-file), hover, completion
- [ ] **Auto-import**: napíš neimportovaný symbol + potvrď completion → automaticky pridá `import`
- [ ] **Quick fix** „Add import" na nerozpoznanom symbole; organize imports / remove unused
- [ ] **Diagnostiky refresh** - po oprave červené squiggle hneď zmizne (žiadne stale)
- [ ] Funguje aj bez `tsconfig.json`/`jsconfig.json` (rozumný fallback)

## 14. Per-project izolácia (KRITICKÉ - otvor 2 projekty v taboch)
- [ ] Diagnostiky / completions / navigácia z jedného projektu **NEpretekajú** do druhého
- [ ] Prepínanie tabov → status bar (branch, cursor), File Structure, diagnostiky patria **aktívnemu** projektu
- [ ] PHP (phpactor) aj JS/TS (tsserver) bežia oddelene per projekt

## 15. Runtime lifecycle / stabilita
- [ ] Zapnúť IDE → phpactor beží; **vypnúť IDE → phpactor sa ukončí**; close project → oba LSP + watchers stop; quit app → všetko stop (žiadne visiace procesy)
- [ ] **Žiadne falošné error toasty** „Something went wrong" / „UnknownDocument" pri bežnej práci (najmä po zatvorení/rename/delete tabu počas písania)
- [ ] Delete súboru s chybami → diagnostiky sa **vyčistia**; po code action staré diagnostiky sa prepíšu (nie stale)

## 16. Regresie (predošlé fixy - over že stále OK)
- [ ] Quick-open nového PHP súboru → otvorí sa **s obsahom** (nie blank)
- [ ] PHPactor beží cez managed `codevo-php.ini` (imagick chyba sa neopakuje)
- [ ] Git diff renderer nie blank
- [ ] „Canceled" / „ResizeObserver loop" sa **NEzobrazujú** ako error notice

---

### Priorita testovania (ak je málo času)
1. **14 + 15** (izolácia + lifecycle/stabilita) - kritické
2. **3** (Cmd-hover regresia) + **5** (vzhľad naprieč témami)
3. **1** (Laravel completions) + **2** (code actions) + **4** (diagnostiky klasifikácia)
4. Zvyšok
