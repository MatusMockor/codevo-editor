# Codevo Editor - QA Test Plán

## Predpoklady (DÔLEŽITÉ)
- [ ] **Čerstvý build** - spusti cez `npm run debug` (NIE starý `.app` bundle - to opakovane spôsobovalo falošné "nefunguje")
- [ ] Testovať na reálnom Laravel projekte (napr. `kontentino/api`) + nejakom JS/TS projekte
- [ ] Otestovať vo viacerých témach (Dark, Light, Dracula, One Dark Pro) - hlavne vzhľad

Pri každom bode zapíš: **OK / CHYBA** + ak chyba: čo si spravil, čo si čakal, čo sa stalo (ideálne screenshot).

---

## 1. PHP code actions (Alt+Enter / Cmd+.)
- [ ] Na **neznámej triede** (`new FooBar()` kde FooBar neexistuje) → ponuka **"Create class FooBar"** hore; potvrď → vytvorí sa súbor na správnej PSR-4 ceste s namespace + otvorí sa
- [ ] Na **existujúcej triede** → "Create class" sa NEponúkne
- [ ] Na **built-in** (`new \Exception()`) → "Create class" sa NEponúkne
- [ ] `$this->neznamaMetoda()` → **"Create method"**; `$this->neznamaProperty` → **"Create property"**
- [ ] `self::neznamaMetoda()` / `static::X` → **static** metóda/konštanta; `parent::metoda()` (parent v tom istom súbore) → metóda v parente
- [ ] Metóda bez return typu → **"Add return type"** (správny typ); netypovaný parameter → **"Add type hint"**
- [ ] **Poradie akcií**: najrelevantnejšia je **prvá** (na chybe = quick-fix prvý); kindy sú vizuálne rozlíšené (žiarovka quick-fix vs kľúč refactor/generate)
- [ ] Implement methods (trieda `implements X`) → vygeneruje stub metódy; Override methods (extends) → override
- [ ] Optimize imports → odstráni nepoužité `use`, zachová použité (aj v PHPDoc `@return`, `@extends`, generics)

## 2. PHP navigácia (Cmd+B, Cmd+click)
- [ ] **Cmd+click = Cmd+B** robia to isté (skok na definíciu)
- [ ] **DÔLEŽITÉ regresia**: drž len **Cmd a hýb myšou** nad symbolom (bez kliknutia) → **NESMIE ťa nikam prehodiť** (predtým to bol bug)
- [ ] Ctrl (na macu) nad symbolom → **NEnaviguje** (to je kontextové menu)
- [ ] Cmd+B na: **trait** metóde (`use Trait` → `$this->traitMethod()`), **interface** metóde, **parent::method()**, zdedenej `$this->method()`, Laravel **scope** (`->aktivnyScope()`), Laravel **relation** (`$model->posts`) → skočí na správny cieľ
- [ ] Laravel: route name, model (route binding), blade view, config/env kľúč → nav funguje

## 3. PHP / Laravel completions
- [ ] `$model->` na Eloquent modeli → ponúkne **fillable atribúty, casts, relations, scopes** (s typmi)
- [ ] Autocomplete na metóde/property → kind ikony (m/p/c) + visibility + typ
- [ ] Query builder reťaz (`Model::where()->...->findOrFail()`) → magic metódy v ponuke, žiadne falošné "undefined method" diagnostiky

## 4. Inspections + diagnostiky
- [ ] **Nepoužitý `use` import** → zožltne (faded warning) + quick-fix "Remove unused import"
- [ ] **Nepoužitá private metóda** → warning + remove
- [ ] **Nepoužitá premenná** (`$x = 5;` nikde nečítaná) → warning; ALE premenná v stringu `"$x"`, `compact('x')`, `&$x`, closure `use($x)` → **žiadny** warning (žiadne falošné poplachy)
- [ ] Po oprave chyby (diagnostika zmizne) → **stale tooltip/hover sa automaticky zavrie** (nezostane visieť stará chyba)

## 5. Refactory
- [ ] **Extract interface** (kurzor na triede) → vytvorí `XxxInterface.php` na disku s public metódami + `use` importmi pre typy v signatúrach + pridá `implements`; interface **reálne existuje po reopene**
- [ ] **Rename symbol = F2** → premenuje naprieč súbormi (PHP aj JS/TS); je v command palette / keymap
- [ ] Extract method / variable, inline variable, generate constructor / getters-setters → fungujú

## 6. Vzhľad / redesign (JetBrains klasik) - testuj vo VIAC TÉMACH
- [ ] **Cmd+R (File Structure / metódy)**: okrúhle **farebné ikony** podľa druhu (method/property/const/class) + visibility `+/−/#` + signatúra `(params): ReturnType`; vybraný riadok je **zaoblený s odsadením** (NIE hranatý obdĺžnik cez celú šírku)
- [ ] **Cmd+. (code action menu)**: zaoblený, soft-accent výber (NIE modrý default Monaco pruh)
- [ ] **Autocomplete / hover / pravý klik** menu: rovnaký štýl (zaoblené, accent výber, kind farby)
- [ ] Palety **Cmd+P / Cmd+Shift+P / Class Open / Search Everywhere**: kompaktné riadky, accent-bar na výbere, footer hinty (↑↓ ↵ esc)
- [ ] **Prepni všetky témy** → farby ikon/popupov ladia s témou, nič nie je nečitateľné / hardcoded

## 7. Find / Replace / Search
- [ ] **Find in files** (search) → rýchle, instant aj na veľkom repe
- [ ] **Replace in files**: replace input + "Replace All" / "Replace in file" → nahradí naprieč súbormi; pred Replace All je **konfirmácia**; regex capture groups (`$1`) fungujú
- [ ] **Quick Open (Cmd+P) / Search Everywhere** → instant písanie (žiadny lag)

## 8. Light mode (Editor Mode / bez IDE)
- [ ] V light mode na PHP/Laravel → **Cmd+B je INSTANTNÝ** (žiadne 5-10s čakanie ako predtým)
- [ ] PHP navigácia v light mode funguje (nie je vypnutá)

## 9. Git workflow
- [ ] Git diff (zmeny) → zobrazí sa (NIE blank)
- [ ] Stage/unstage jednotlivé súbory (checkbox), per-hunk stage v diffe, revert
- [ ] Commit / Commit & Push; stash (save/apply/pop/drop); branch switch/create; file history; blame
- [ ] **Nové skratky**: stash, switch branch, blame, file history, local history, commit (Cmd+Enter) - over v keymape že fungujú
- [ ] Stage tlačidlo má **Plus ikonu** (nie holý `+`); labely "Stage/Unstage"
- [ ] **Change gutter**: farebné markery (added/modified/deleted) v ľavom okraji; klik → preview + "Revert change"
- [ ] **Alt+F5 / Shift+Alt+F5** → skok na ďalšiu/predošlú zmenu priamo v editore

## 10. Status bar (dole)
- [ ] **"Ln X, Col Y"** (pozícia kurzora) → zobrazená a **mení sa** pri pohybe kurzora; klik → Go to Line
- [ ] **Git branch** zobrazená dole; klik → otvorí branch panel
- [ ] Ostatné (problems, mode, language, project) → bez šumu/blikania
- [ ] Pravý klik na status bar → toggle položiek (vrátane cursor/branch)

## 11. Command palette / keymap
- [ ] **Cmd+Shift+P**: šípky ↑↓ (s wrap), Enter spustí zvýraznený, aktívny riadok zvýraznený, prázdny filter → **"No matching commands"** (nie prázdny biely panel)
- [ ] **Settings → Keymap**: **search box** filtruje 72 skratiek podľa názvu/kategórie; rebind funguje
- [ ] **F2 rename**, **Cmd+Shift+- / =** fold all / unfold all → fungujú

## 12. Vue (.vue súbory) - len ak máš Vue projekt
- [ ] `.vue` súbor → **syntax highlighting** (template/script/style farebné, nie plaintext)
- [ ] `<script setup lang="ts">` → TS **completions / hover / go-to-def** (ak je nainštalovaný @vue/typescript-plugin)

## 13. JSON schema
- [ ] Otvor `.phpactor.json` (alebo JSON s `$schema`) → **žiadna žltá vlnovka** ani chyba "No schema request service available (768)" na `$schema` riadku

## 14. EditorConfig
- [ ] V projekte s `.editorconfig` → indent (tabs/spaces, veľkosť) a EOL sa riadia podľa configu; na save sa trimuje trailing whitespace + final newline

## 15. Per-project izolácia (KRITICKÉ - otvor 2 projekty v tabboch)
- [ ] Otvor **2 rôzne projekty** v dvoch taboch. Diagnostiky/completions/nav z jedného projektu **NEpretekajú** do druhého
- [ ] Prepínanie tabov → status bar (branch, cursor), File Structure, diagnostiky vždy patria **aktívnemu** projektu
- [ ] PHP (phpactor) aj JS/TS (tsserver) procesy bežia oddelene per projekt

## 16. Lifecycle / stabilita
- [ ] **Žiadne falošné error toasty** "Something went wrong" / "UnknownDocument" pri bežnej práci (najmä po zatvorení/rename/delete tabu počas písania)
- [ ] Delete súboru s chybami → diagnostiky sa **vyčistia**
- [ ] Rename / open / preview tab → bez stale errorov
- [ ] Po code action (ktorá zmení súbor) → staré diagnostiky sa **prepíšu** (nezostanú visieť)
- [ ] Vypnutie IDE mode / zatvorenie appky → bez visiacich procesov/chýb

## 17. Regresie (predošlé fixy - over že stále OK)
- [ ] Quick-open nového PHP súboru → otvorí sa **s obsahom** (nie blank)
- [ ] PHPactor beží cez managed `codevo-php.ini` (imagick chyba sa neopakuje)
- [ ] Git diff renderer → nie blank
- [ ] "Canceled" / "ResizeObserver loop" → **NEzobrazujú** sa ako error notice

---

### Priorita testovania (ak je málo času)
1. **Sekcia 15 + 16** (izolácia + stabilita) - kritické
2. **Sekcia 2** (Cmd-hover regresia) + **6** (vzhľad naprieč témami)
3. **Sekcia 1** (code actions) + **3** (Laravel completions)
4. Zvyšok
