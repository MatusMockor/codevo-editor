# Codevo Editor - QA Test Plán (aktuálny)

## Predpoklady (DÔLEŽITÉ)
- [ ] **Čerstvý build** - `npm run debug` (NIE starý `.app` bundle)
- [ ] Reálny Laravel projekt (napr. `kontentino/api`) + nejaký JS/TS projekt
- [ ] Otestovať vo viacerých témach (Dark, Light, Dracula, One Dark Pro)
- [ ] Pri každom bode zapíš OK / CHYBA (+ kroky/screenshot pri chybe)
- Pozn.: **Vue/Nuxt je mimo scope**.
- 💡 Pri akejkoľvek chybe v PHP/JS inteligencii otvor **Runtime panel (Cmd+Shift+R)** → **„Copy debug bundle"** a priloz ho k reportu.

---

## 1. PHP / Laravel completions
- [ ] `$model->` ponúkne fillable, casts, **DB stĺpce z migrácií**, relations, scopes - s typmi
- [ ] **Kategórie sú vizuálne oddelené farbou ikony** (property / relation / method / scope / magic-where, + Laravel value/view) + tichý category label; naše návrhy **vyššie než phpactor**
- [ ] `Model::` (static) rovnaké kategórie + ordering
- [ ] **Macros z providerov**: `Builder::macro('x')` v `app/Providers/*` → `x` na builder (aj Query Builder / Collection / Model)
- [ ] **Chain naprieč vrstvami**: `$repo->find()->` → model; **`$repo->findOrFail()->` aj pri `*RepositoryContract` / `*RepositoryInterface`** type; `new UserResource($m)->` → resource; `$resource->response()` → JsonResponse; `Model::query()->where()->first()->` → model
- [ ] **Container binding**: `app()->make(FooInterface::class)->` resolvuje **concrete** (z `bind`/`singleton` v provideri); `Model::with('` → názvy relácií

## 2. PHP code actions (Alt+Enter / Cmd+.)
- [ ] **Poradie**: najrelevantnejšia prvá (pre-highlighted); skupiny „Quick Fix" / „Refactor" + ikony (žiarovka/kľúč) vizuálne rozlíšené
- [ ] **Create class** (`new FooBar()`) → PSR-4 súbor + namespace; existujúca/built-in → NEponúkne
- [ ] **Create method/property** z usage: `$this->x()`, `self::`/`static::`, `parent::` (same-file), typed property
- [ ] **Add return type / type hint**, **Extract interface** (na disk + `use` + `implements`), Implement/Override, Optimize imports

## 3. PHP navigácia (Cmd+B, Cmd+click)
- [ ] **Cmd+click = Cmd+B**
- [ ] **REGRESIA**: drž len **Cmd a hýb myšou** nad symbolom (bez kliku) → **NESMIE prehodiť**, žiadny error toast
- [ ] Cmd+B na: trait / interface / `parent::` / `self::`/`static::` / zdedenú / Laravel scope / Laravel relation
- [ ] Laravel route / model / blade view / config-env

## 4. PHP diagnostiky
- [ ] **Klasifikácia**: reálna chyba → **červená error**; Laravel magic → **jemný hint** tag `laravel-magic`; phpactor parse-šum → skrytý
- [ ] **Inspekcie**: nepoužitý import/private metóda/premenná + Remove; ale string/`compact()`/`&$x`/closure `use($x)` → **žiadny** false poplach
- [ ] **Container chain**: `app()->make(X::class)->method()` → žiadne falošné „undefined method"
- [ ] Po oprave chyby → stale hover sa sám zavrie

## 5. Vzhľad / redesign (JetBrains klasik) - VO VIAC TÉMACH
- [ ] **Cmd+R**: okrúhle farebné kind-ikony + visibility `+/−/#` + signatúra; vybraný riadok zaoblený s odsadením
- [ ] **Cmd+.**, **autocomplete / hover / pravý klik**: zaoblené, soft-accent výber, kind farby
- [ ] **Palety** (Cmd+P / Cmd+Shift+P / Class Open / Search Everywhere): kompaktné, accent-bar, footer hinty
- [ ] **Prepni témy** → farby ladia, nič nečitateľné

## 6. Find / Replace / Search
- [ ] **Replace in files** (Replace All / per file) + konfirmácia + regex capture (`$1`); Quick Open / Search Everywhere instant

## 7. Light mode
- [ ] PHP/Laravel **Cmd+B INSTANTNÝ** (žiadne 5-10s)

## 8. Git workflow + Local Changes (JetBrains-like)
- [ ] **Local Changes panel**: farebná status-ikona per súbor + počet zmien v headeri; **aktívny riadok = jeden čistý highlight**
- [ ] Stage/unstage + **per-hunk** (prvý/posledný/viacero/pure add/pure delete), revert, commit / commit & push (Cmd+Enter), stash, branch, file history, blame (+ skratky)
- [ ] **Change gutter**: klik → **rollback popover** s Revert + Previous/Next (popover sleduje hunk, tlačidlá majú hover-fill) + čistý removed/added diff
- [ ] **Alt+F5 / Shift+Alt+F5** skok medzi zmenami

## 9. Status bar
- [ ] **„Ln X, Col Y"** (klik → Go to Line), **Git branch** (klik → panel), bez šumu, pravý klik → toggle

## 10. Command palette / keymap
- [ ] **Cmd+Shift+P**: ↑↓ (wrap), Enter spustí zvýraznený, prázdny → „No matching commands"
- [ ] **Settings → Keymap** search; **F2 rename** cross-file; **Cmd+Shift+- / =** fold all / unfold

## 11. JSON schema
- [ ] `.phpactor.json` / JSON s `$schema` → žiadna žltá vlnovka ani „768"

## 12. EditorConfig
- [ ] `.editorconfig` → indent + EOL podľa configu; save trim + final newline

## 13. JS/TS (Light mode = VS Code parity)
- [ ] Go to definition / implementation / references, rename (F2), hover, completion
- [ ] **Auto-import** (completion → `import`), **Quick fix** „Add import", organize/remove unused, **diagnostiky refresh** (squiggle hneď zmizne)
- [ ] Funguje aj bez `tsconfig.json`/`jsconfig.json`

## 14. Runtime diagnostic cockpit (Cmd+Shift+R / BottomPanel „Runtime")
- [ ] Per projekt pre **phpactor + tsserver**: **PID**, farebný **stav** (running/starting/crashed/stopped), **RAM**, **CPU**, **crash reason**
- [ ] **Restart** → nový PID, running; **Stop** → stopped; **Log** shortcut
- [ ] **Recent LSP requests** tabuľka: posledné requesty s **latenciami** (ms) + ok/error (error riadky zvýraznené)
- [ ] **Stderr tail** inline (posledné riadky, pri crashe vidno kontext bez otvárania logu)
- [ ] **Operation latency** tabuľka: quick-open / search-everywhere / go-to-definition / completion / folder-expand → **median / p95 / last / N** + green/amber/red health dot
- [ ] **„Copy debug bundle"** → do clipboardu markdown (projekt, mode, per runtime: PID/stav/RAM/CPU/crash/recent requests/stderr) - paste do bug reportu
- [ ] Pri 2 projektoch v taboch panel ukazuje **aktívny** projekt (žiadny leak metrík/latencií)

## 15. Index progress
- [ ] Cold index veľkého projektu → status bar **„Indexing X of N (P%)"** (nie statický spinner); neznámy total → „Indexing X files"

## 16. Per-project izolácia (KRITICKÉ - 2 projekty v taboch)
- [ ] Diagnostiky / completions / navigácia / **observability / latencie / index progress** z jedného projektu **NEpretekajú** do druhého
- [ ] Prepínanie tabov → status bar, File Structure, diagnostiky, runtime panel patria **aktívnemu** projektu

## 17. Runtime lifecycle / stabilita
- [ ] Zapnúť IDE → phpactor beží; **vypnúť IDE → phpactor stop**; close project → oba LSP + watchers stop; quit app → všetko stop (over v Runtime paneli + Activity Monitor - žiadne visiace procesy)
- [ ] **Žiadne falošné error toasty** „Something went wrong" / „UnknownDocument" (najmä po zatvorení/rename/delete tabu počas písania)
- [ ] Delete súboru s chybami → diagnostiky sa vyčistia; po code action staré diagnostiky sa prepíšu

## 18. Regresie (over že stále OK)
- [ ] Quick-open nového PHP súboru → **s obsahom** (nie blank)
- [ ] PHPactor cez managed `codevo-php.ini` (imagick chyba sa neopakuje)
- [ ] Git diff renderer nie blank
- [ ] „Canceled" / „ResizeObserver loop" sa **NEzobrazujú** ako error notice

---

### Priorita testovania (ak je málo času)
1. **16 + 17** (izolácia + lifecycle) + **14** (diagnostic cockpit - pomáha reportovať bugy)
2. **3** (Cmd-hover regresia) + **5** (vzhľad naprieč témami)
3. **1** (Laravel completions + chain + container binding) + **2** (code actions) + **4** (diagnostiky klasifikácia)
4. **8** (git Local Changes + per-hunk) + **15** (index progress) + zvyšok
