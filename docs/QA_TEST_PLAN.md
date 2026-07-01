# Codevo Editor - QA Test Plán (aktuálny)

## Predpoklady (DÔLEŽITÉ)
- [ ] **Čerstvý build** - `npm run debug` (NIE starý `.app` bundle)
- [ ] Reálny Laravel projekt (napr. `kontentino/api`) + nejaký JS/TS projekt
- [ ] Otestovať vo viacerých témach (Dark, Light, Dracula, One Dark Pro)
- [ ] Pri každom bode zapíš OK / CHYBA (+ kroky/screenshot pri chybe)
- Pozn.: **Vue/Nuxt je mimo scope**.
- 💡 Pri akejkoľvek chybe v PHP/JS inteligencii otvor **Runtime panel (Cmd+Shift+R)** → **„Copy debug bundle"** a priloz ho k reportu.
- ℹ️ PHP correctness (completions/chain/diagnostiky matica 23 scenárov) a runtime chaos/lifecycle testy bežia **automaticky v test suite** - manuálne stačí spot-check podľa sekcií nižšie.

---

## 1. PHP / Laravel completions
- [ ] `$model->` ponúkne fillable, casts, **DB stĺpce z migrácií**, relations, scopes - s typmi
- [ ] **Kategórie vizuálne oddelené farbou ikony** (property / relation / method / scope / magic-where, + Laravel value/view) + tichý category label; naše návrhy **vyššie než phpactor**
- [ ] `Model::` (static) rovnaké kategórie + ordering
- [ ] **Macros z providerov**: `Builder::macro('x')` v `app/Providers/*` → `x` na builder (aj Query Builder / Collection / Model). *Known gap: macro sa neponúka na holom `$model->`, len na `Model::query()->` - nereportovať ako bug*
- [ ] **Chain naprieč vrstvami**: `$repo->find()->` → model (aj `*RepositoryContract`/`*RepositoryInterface`); `new UserResource($m)->` → resource; `$resource->response()` → JsonResponse; `Model::query()->where()->first()->` → model
- [ ] **Container binding**: `app()->make(FooInterface::class)->` → concrete (z `bind`/`singleton` v provideri); `Model::with('` → názvy relácií

## 2. PHP code actions (Alt+Enter / Cmd+.)
- [ ] **Poradie**: najrelevantnejšia prvá (pre-highlighted); skupiny „Quick Fix" / „Refactor" + ikony rozlíšené
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
- [ ] **Inspekcie**: nepoužitý import/private metóda/premenná + Remove; string/`compact()`/`&$x`/closure `use($x)` → **žiadny** false poplach
- [ ] **Container chain**: `app()->make(X::class)->method()` → žiadne falošné „undefined method"
- [ ] Po oprave chyby → stale hover sa sám zavrie

## 5. Vzhľad / redesign (JetBrains klasik) - VO VIAC TÉMACH
- [ ] **Cmd+R**: okrúhle farebné kind-ikony + visibility `+/−/#` + signatúra; vybraný riadok zaoblený s odsadením
- [ ] **Cmd+.**, **autocomplete / hover / pravý klik**: zaoblené, soft-accent výber, kind farby
- [ ] **Palety**: kompaktné, accent-bar, footer hinty
- [ ] **Prepni témy** → farby ladia, nič nečitateľné

## 6. Find / Replace / Search (NOVÉ detaily)
- [ ] **Quick Open (Cmd+P) / Search Everywhere**: matchnutá časť názvu/cesty je **zvýraznená** vo výsledkoch (accent highlight) - over pri rôznych queries a témach
- [ ] **Replace in files** (Replace All / per file) + konfirmácia + regex capture (`$1`); vyhľadávanie instant

## 7. Light mode
- [ ] PHP/Laravel **Cmd+B INSTANTNÝ** (žiadne 5-10s)

## 8. Git workflow + Local Changes (JetBrains-like)
- [ ] **Local Changes panel**: farebná status-ikona per súbor + počet zmien; aktívny riadok = čistý highlight; **plynulé aj pri 100+ zmenených súboroch**
- [ ] Stage/unstage + **per-hunk** (prvý/posledný/viacero/pure add/pure delete), revert, commit / commit & push (Cmd+Enter), stash, branch, file history, blame (+ skratky)
- [ ] **Change gutter**: klik → rollback popover s Revert + Previous/Next + čistý diff
- [ ] **Alt+F5 / Shift+Alt+F5** skok medzi zmenami

## 9. Status bar (NOVÉ: auto-dismiss)
- [ ] **„Ln X, Col Y"** (klik → Go to Line), **Git branch** (klik → panel), pravý klik → toggle
- [ ] **Transient správy** („Saved X", „Diff Y"...) **samé zmiznú po ~5s** - nevisia donekonečna; nová správa reštartuje časovač

## 10. Command palette / keymap (NOVÉ: conflict + key-capture)
- [ ] **Cmd+Shift+P**: ↑↓ (wrap), Enter spustí zvýraznený, prázdny → „No matching commands"
- [ ] **Settings → Keymap**: search filtruje; **rebind stlačením kláves** (key-capture - stlač napr. Cmd+Shift+K a zapíše sa); pri **kolízii dvoch príkazov na jednej skratke sa zobrazí varovanie** (warning, neblokuje)
- [ ] Key-capture **nerozbíja** Tab/Shift+Tab navigáciu ani písanie textu v iných poliach
- [ ] **F2 rename** cross-file; **Cmd+Shift+- / =** fold all / unfold

## 11. JSON schema
- [ ] `.phpactor.json` / JSON s `$schema` → žiadna žltá vlnovka ani „768"

## 12. EditorConfig
- [ ] `.editorconfig` → indent + EOL podľa configu; save trim + final newline

## 13. JS/TS (Light mode = VS Code parity)
- [ ] Go to definition / implementation / references, rename (F2), hover, completion
- [ ] **Auto-import**, Quick fix „Add import", organize/remove unused, diagnostiky refresh
- [ ] Funguje aj bez `tsconfig.json`/`jsconfig.json`

## 14. Runtime diagnostic cockpit (Cmd+Shift+R / BottomPanel „Runtime")
- [ ] Per projekt pre **phpactor + tsserver**: PID, farebný stav, RAM, CPU, crash reason
- [ ] **Restart** → nový PID; **Stop** → stopped; Log shortcut
- [ ] **Recent LSP requests** s latenciami (error riadky zvýraznené); **stderr tail** inline
- [ ] **Operation latency** tabuľka (quick-open / search / go-to-def / completion / folder-expand → median/p95/last + health dot)
- [ ] **„Copy debug bundle"** → markdown do clipboardu
- [ ] Pri 2 projektoch panel ukazuje **aktívny** (žiadny leak)

## 15. Index progress
- [ ] Cold index → status bar **„Indexing X of N (P%)"** (nie statický spinner)

## 16. Per-project izolácia (KRITICKÉ - 2 projekty v taboch)
- [ ] Diagnostiky / completions / navigácia / observability / latencie / index progress **NEpretekajú** medzi projektmi
- [ ] Prepínanie tabov → všetko patrí **aktívnemu** projektu

## 17. Runtime lifecycle / stabilita
- [ ] IDE on → phpactor beží; **IDE off → phpactor stop**; close project → oba LSP stop; quit → všetko stop (over v Runtime paneli + Activity Monitor)
- [ ] Skús aj hrubšie scenáre (automatizovaný chaos test to pokrýva, ale spot-check): **killni phpactor proces ručne** (Activity Monitor) → editor to zvládne (crashed stav / restart), žiadny zombie; rýchle prepínanie IDE mode viackrát za sebou → žiadne visiace procesy
- [ ] **Žiadne falošné error toasty** „Something went wrong" / „UnknownDocument" (najmä po zatvorení/**rename**/delete tabu počas písania)
- [ ] Delete/rename súboru s chybami → diagnostiky sa vyčistia

## 18. Regresie (over že stále OK)
- [ ] Quick-open nového PHP súboru → **s obsahom** (nie blank)
- [ ] PHPactor cez managed `codevo-php.ini` (imagick sa neopakuje)
- [ ] Git diff renderer nie blank
- [ ] „Canceled" / „ResizeObserver loop" sa **NEzobrazujú** ako error notice

---

### Priorita testovania (ak je málo času)
1. **16 + 17** (izolácia + lifecycle vrátane ručného kill testu) + **14** (cockpit)
2. **3** (Cmd-hover regresia) + **5** (vzhľad naprieč témami)
3. **1** (Laravel completions + chain + container) + **2** (code actions) + **4** (diagnostiky)
4. **6 + 9 + 10** (nové UX detaily: match highlight, auto-dismiss, keymap conflict/key-capture) + zvyšok
