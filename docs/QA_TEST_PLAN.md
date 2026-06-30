# Codevo Editor - QA Test Plán (aktuálny)

## Predpoklady (DÔLEŽITÉ)
- [ ] **Čerstvý build** - `npm run debug` (NIE starý `.app` bundle)
- [ ] Reálny Laravel projekt (napr. `kontentino/api`) + nejaký JS/TS projekt
- [ ] Otestovať vo viacerých témach (Dark, Light, Dracula, One Dark Pro) - hlavne vzhľad
- [ ] Pri každom bode zapíš OK / CHYBA (+ kroky/screenshot pri chybe)
- Pozn.: **Vue/Nuxt je mimo scope** - netestovať.

---

## 1. PHP / Laravel completions
- [ ] `$model->` ponúkne: **fillable, casts, DB stĺpce z migrácií** (`id`, `created_at`...), **relations, scopes** - s typmi
- [ ] Completion **zoradené po kategóriách**: property → relation → method → scope → **magic-where**, každá s odlišnou ikonou; naše návrhy **vyššie než phpactor**
- [ ] `Model::` (static) má rovnaké kategórie + ordering
- [ ] **Macros z providerov**: `Builder::macro('x')` v `app/Providers/*.php` → `x` na builder receiveri (aj Query Builder / Collection / Model macros)
- [ ] **Chain naprieč vrstvami**: `$repo->find()->` → model; `new UserResource($model)->` / `UserResource::make($model)->` → **resource členy**; `$resource->response()` → **JsonResponse**; `Model::query()->where()->first()->` → model atribúty
- [ ] `Model::with('` → názvy relácií

## 2. PHP code actions (Alt+Enter / Cmd+.)
- [ ] **Poradie**: najrelevantnejšia prvá; kindy vizuálne rozlíšené (žiarovka vs kľúč)
- [ ] **Create class** (`new FooBar()`) → PSR-4 súbor + namespace; existujúca/built-in → NEponúkne
- [ ] **Create method/property** z usage: `$this->x()`, `self::`/`static::` (static), `parent::` (same-file), `$this->prop = new Foo()` (typed)
- [ ] **Add return type / Add type hint** (PHPDoc / typ vrátenej property / default)
- [ ] **Extract interface** → `XxxInterface.php` na disku s `use` + `implements`
- [ ] **Implement / Override**, **Optimize imports** (zachová PHPDoc `@extends`/generics)

## 3. PHP navigácia (Cmd+B, Cmd+click)
- [ ] **Cmd+click = Cmd+B**
- [ ] **REGRESIA**: drž len **Cmd a hýb myšou** nad symbolom (bez kliku) → **NESMIE ťa prehodiť**, žiadny error toast
- [ ] Cmd+B na: trait / interface / `parent::` / `self::`/`static::` / zdedenú `$this->` / Laravel scope / Laravel relation
- [ ] Laravel route / model (route binding) / blade view / config-env

## 4. PHP diagnostiky
- [ ] **Klasifikácia**: reálna chyba → **červená error**; Laravel magic (builder/macro/scope) → **jemný hint** tag `laravel-magic` (nie červená, nie skrytá); phpactor parse-šum → skrytý
- [ ] **Inspekcie**: nepoužitý import/private metóda/premenná + Remove; ale premenná v stringu/`compact()`/`&$x`/closure `use($x)` → **žiadny** false poplach
- [ ] **Container chain**: `app()->make(X::class)->method()` → žiadne falošné „undefined method"
- [ ] Po oprave chyby → **stale hover sa sám zavrie**

## 5. Vzhľad / redesign (JetBrains klasik) - VO VIAC TÉMACH
- [ ] **Cmd+R**: okrúhle farebné kind-ikony + visibility `+/−/#` + signatúra `(params): ReturnType`; vybraný riadok zaoblený s odsadením
- [ ] **Cmd+.**: zaoblený, soft-accent výber (nie modrý default)
- [ ] **Autocomplete / hover / pravý klik**: rovnaký štýl, kind farby
- [ ] **Palety** (Cmd+P / Cmd+Shift+P / Class Open / Search Everywhere): kompaktné, accent-bar, footer hinty
- [ ] **Prepni témy** → farby ladia, nič nečitateľné

## 6. Find / Replace / Search
- [ ] **Replace in files** (Replace All / Replace in file) + **konfirmácia** + regex capture (`$1`)
- [ ] Quick Open (Cmd+P) / Search Everywhere - instant

## 7. Light mode
- [ ] PHP/Laravel **Cmd+B INSTANTNÝ** (žiadne 5-10s)

## 8. Git workflow + Local Changes (JetBrains-like)
- [ ] **Local Changes panel**: každý súbor má **farebnú status-ikonu** (added/modified/deleted/renamed/untracked/conflicted) + header ukazuje **počet zmien**
- [ ] Stage/unstage súbor + **per-hunk** (prvý/posledný/viacero hunkov, pure add, pure delete), revert, commit / commit & push (Cmd+Enter)
- [ ] Stash, branch switch/create, file history, blame - vrátane **skratiek**
- [ ] **Change gutter**: klik na marker → **rollback popover** s Revert + **Previous/Next change** (popover sleduje hunk) + čistý removed/added inline diff
- [ ] **Alt+F5 / Shift+Alt+F5** skok medzi zmenami v editore

## 9. Status bar (dole)
- [ ] **„Ln X, Col Y"** mení sa pri pohybe; klik → Go to Line
- [ ] **Git branch** dole; klik → branch panel
- [ ] Bez šumu/blikania; pravý klik → toggle položiek

## 10. Command palette / keymap
- [ ] **Cmd+Shift+P**: ↑↓ (wrap), Enter spustí zvýraznený, prázdny filter → „No matching commands"
- [ ] **Settings → Keymap**: search box filtruje; rebind funguje
- [ ] **F2 rename** (cross-file), **Cmd+Shift+- / =** fold all / unfold

## 11. JSON schema
- [ ] `.phpactor.json` (alebo JSON s `$schema`) → **žiadna žltá vlnovka** ani „768"

## 12. EditorConfig
- [ ] `.editorconfig` → indent + EOL podľa configu; na save trim + final newline

## 13. JS/TS (Light mode = VS Code parity)
- [ ] Go to definition / implementation / references, rename (F2 cross-file), hover, completion
- [ ] **Auto-import**: neimportovaný symbol + completion → automaticky `import`
- [ ] **Quick fix** „Add import"; organize / remove unused
- [ ] **Diagnostiky refresh** - po oprave squiggle hneď zmizne
- [ ] Funguje aj bez `tsconfig.json`/`jsconfig.json`

## 14. Runtime observability panel (NOVÉ)
- [ ] Otvor **Cmd+Shift+R** (alebo BottomPanel „Runtime" tab / command palette „Show Runtime Panel")
- [ ] Per aktívny projekt vidíš pre **phpactor + tsserver**: **PID**, farebný **stav** (zelená running / amber starting / červená crashed / sivá stopped), **RAM**, **CPU**, **posledný crash reason**
- [ ] **Restart** runtime → proces sa reštartuje (nový PID, stav running); **Stop** → proces stop (stav stopped)
- [ ] **Log shortcut** (tsserver) otvorí log
- [ ] Pri 2 projektoch v taboch panel ukazuje runtimes **aktívneho** projektu (žiadny leak)

## 15. Index progress (NOVÉ)
- [ ] Pri otvorení veľkého projektu (cold index) status bar ukazuje **„Indexing X of N (P%)"** postupne (nie statický spinner ktorý vyzerá ako hang)
- [ ] Po dokončení → normálny stav; pri neznámom total → „Indexing X files"

## 16. Per-project izolácia (KRITICKÉ - otvor 2 projekty v taboch)
- [ ] Diagnostiky / completions / navigácia / **observability / index progress** z jedného projektu **NEpretekajú** do druhého
- [ ] Prepínanie tabov → status bar (branch, cursor), File Structure, diagnostiky, runtime panel patria **aktívnemu** projektu
- [ ] phpactor aj tsserver bežia oddelene per projekt

## 17. Runtime lifecycle / stabilita
- [ ] Zapnúť IDE → phpactor beží; **vypnúť IDE → phpactor sa ukončí**; close project → oba LSP + watchers stop; quit app → všetko stop (žiadne visiace procesy - over v Runtime paneli + Activity Monitor)
- [ ] **Žiadne falošné error toasty** „Something went wrong" / „UnknownDocument" (najmä po zatvorení/rename/delete tabu počas písania)
- [ ] Delete súboru s chybami → diagnostiky sa **vyčistia**; po code action staré diagnostiky sa prepíšu (nie stale)

## 18. Regresie (over že stále OK)
- [ ] Quick-open nového PHP súboru → **s obsahom** (nie blank)
- [ ] PHPactor cez managed `codevo-php.ini` (imagick chyba sa neopakuje)
- [ ] Git diff renderer nie blank
- [ ] „Canceled" / „ResizeObserver loop" sa **NEzobrazujú** ako error notice

---

### Priorita testovania (ak je málo času)
1. **16 + 17** (izolácia + lifecycle/stabilita) + **14** (observability panel - práve pomáha debugovať)
2. **3** (Cmd-hover regresia) + **5** (vzhľad naprieč témami)
3. **1** (Laravel completions + chain) + **2** (code actions) + **4** (diagnostiky klasifikácia)
4. **8** (git Local Changes + per-hunk) + zvyšok
