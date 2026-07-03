# Codevo Editor - QA Test Plan (Nette + Latte + NEON, Git Directory Mappings)

Verzia: 2026-07-04
Pokrytie: Nette framework podpora (Faza 1 + Faza 2), Git directory mappings (multi-repo workspace), regresie Laravel/light mode.

## Predpoklady (DOLEZITE)

- [ ] **Cerstvy build** - `npm run debug` (NIE stary `.app` bundle)
- [ ] **Realny Nette projekt** s Latte sablonami a `.neon` configmi (composer musi obsahovat `nette/application` alebo `latte/latte`). Ak nie je k dispozicii, vytvor si minimalny: `composer.json` s nette/application, `app/Presenters/HomePresenter.php` (alebo moderna struktura `app/UI/Home/`), `.latte` sablony, `config/services.neon`
- [ ] **Realny Laravel projekt** (regresie) - napr. invoices/kontentino
- [ ] **Multi-repo projekt** pre git mappings - `/Users/matusmockor/Developer/LetsConsult/attendancer` (hlavny repo + package repos vo `workbench/lcsk/*`, composer path symlinks)
- [ ] **JS/TS projekt** (light mode regresie)
- [ ] Pri kazdom bode zapis OK / CHYBA (+ kroky/screenshot pri chybe)
- Pri chybe v PHP/Nette/git inteligencii: **Runtime panel (Cmd+Shift+R)** - "Copy debug bundle" a priloz k reportu
- Poznamka: domain parsery (Latte/NEON/link/mapping resolver), izolacne a kolizne scenare bezia automaticky v suite (4800+ testov) - manualne staci overit end-to-end UX

---

## 1. Framework detekcia a exkluzivita (KRITICKE - jadro pozadavky)

- [ ] Otvor **Nette projekt** + zapni IDE mode - status bar chip ukazuje "· Nette"
- [ ] Otvor **Laravel projekt** - chip ukazuje "· Laravel"; genericky PHP projekt - bez segmentu
- [ ] **V Nette projekte sa NEaktivuje Laravel magic**: v PHP subore `$model->` neponuka Eloquent scopes/relations magic; `route('` / `config('` / `view('` NEponukaju Laravel completion; `.blade.php` subor (ak by existoval) NEdostane Blade semantic
- [ ] **V Laravel projekte sa NEaktivuje Nette**: `.latte` subor ma len syntax highlighting (ziadne member completion), `.neon` len farbenie, `{control` bez completion
- [ ] Projekt s obomi balikmi v lock subore (napr. Laravel s transitivnym latte/latte) - profil je Laravel, ziadne Nette completion (exkluzivita)
- [ ] Prepinanie tabov Nette projekt <-> Laravel projekt - completion/nav/diagnostiky patria vzdy aktivnemu projektu (izolacia; ziadny leak)

## 2. Latte - jazyk a highlighting (bezi VZDY, aj v basic mode)

- [ ] `.latte` subor sa otvori so syntax farbenim: HTML baza + `{$var}`, `{foreach}`, `{if}`, filtre `|upper`, `n:atributy`, `{* komentar *}`
- [ ] `.neon` subor: kluce, hodnoty, `#` komentare, `@service`, `%param%`, `Class(args)` zafarbene
- [ ] JS objekt v `<script>` bloku `.latte` suboru (`{enabled: true}`) sa NEfarbi ako Latte macro
- [ ] Neuzavrety tag pocas pisania (`{foreach $items as $item` bez `}`) NEpokazi farbenie zvysku suboru
- [ ] Tagy vnutri `{* komentara *}` nesvietia
- [ ] Cmd+/ v `.latte` togglene `{* *}` komentar; v `.neon` `#` komentar; emmet funguje v `.latte`

## 3. Latte - navigacia (IDE mode + Nette projekt)

- [ ] **Cmd+B na `{include 'file.latte'}`** - otvori subor; funguje aj `{layout}`, `{extends}`, `{import}`, `{embed}`
- [ ] **Bare `{layout}` / auto-lookup** - skoci na `@layout.latte` (hlada v adresari sablony + rodicoch)
- [ ] `{include blockname}` (bez uvodzoviek) - NEnaviguje na subor (blok, nie subor - spravne)
- [ ] Napisanie `{` ponukne Latte tagy; `{include '` ponukne `.latte` sablony workspace (relativne cesty)
- [ ] Obe struktury projektu: klasicka `app/Presenters/templates/...` aj moderna `app/UI/<Name>/` (sablona vedla presenteru)

## 4. Latte - premenne a member completion (VELKA VEC - PhpStorm parita)

- [ ] Presenter: `$this->template->invoice = $invoice;` v `renderShow()` - v `show.latte` napis `{$invoice->` - ponuknu sa **members** (metody, properties)
- [ ] `{$` ponukne zoznam premennych sablony s typmi
- [ ] **`{varType App\Model\Product $product}`** v sablone - typ plati (ma prednost pred presenterom); `{parameters}` a `{templateType}` tiez
- [ ] `{var $x = ...}` lokalna premenna - v zozname
- [ ] **`{foreach $products as $p}`** - `{$p->` ponukne members elementu kolekcie; vnorene foreach funguje
- [ ] Premenna priradena v `startup()`/`beforeRender()` - dostupna vo vsetkych sablonach presenteru
- [ ] Filter completion: `{$name|` ponukne Latte filtre (upper, truncate, date...)
- [ ] 2 presentery posielaju do tej istej sablony ROZNE typy tej istej premennej - ziadne members (konzervativne, ziadne hadanie)

## 5. Nette - {control} a komponenty (Faza 2)

- [ ] **Cmd+B na `{control contactForm}`** - skoci na `createComponentContactForm()` v presenteri
- [ ] `<form n:name="contactForm">` - Cmd+B rovnako; `<input n:name="field">` NEnaviguje (field, nie komponent - spravne)
- [ ] `{control contactForm:part}` - navigacia na base komponent (part sa ignoruje)
- [ ] Napisanie `{control ` ponukne komponenty aktualneho presenteru
- [ ] **Reverz: Cmd+B na nazve `createComponentContactForm`** v PHP - skoci na prvy `{control}` usage v sablonach presenteru

## 6. Nette - {link} / n:href navigacia (Faza 1/S7)

- [ ] **Cmd+B na `n:href="Product:show"`** - skoci na `ProductPresenter::renderShow()` (alebo actionShow)
- [ ] `{link Product:show}` / `{plink ...}` rovnako; `$this->link('Product:show')` / `->redirect(...)` v PHP presenteri rovnako
- [ ] Signal `delete!` - skoci na `handleDelete()`
- [ ] **Modularny projekt**: relativny target z modulu (`Product:show` z Admin modulu) - skoci do Admin modulu presenteru (nie top-level)
- [ ] Completion `Presenter:action` cielov pri pisani `{link ` / `n:href="`
- [ ] Dynamicky target (`{link $dest}`) - ziadna navigacia (spravne)

## 7. NEON config inteligencia

- [ ] **Cmd+B na FQN triede v `services.neon`** (`App\Model\ProductRepository`) - otvori PHP triedu; funguje aj `Class::method` factory (skoci na triedu)
- [ ] `includes:` polozka - Cmd+B otvori dalsi `.neon` subor
- [ ] Class completion v `services:` hodnotach (za `factory:`, `- `, atd.); NEponuka v `setup:`/`arguments:` blokoch
- [ ] **`%dbHost%` Cmd+B** - skoci na definiciu v `parameters:` (aj cross-file: parameter v inom config/*.neon); `%mail.from%` dotted funguje
- [ ] Napisanie `%` v hodnote ponukne parametre; `@` ponukne services
- [ ] `@service` Cmd+B - skoci na definiciu службy; `@\App\Class` - na PHP triedu

## 8. Nette - diagnostiky (false positives)

- [ ] `$this->template->anything = ...` v presenteri - phpactor chyba je downgradnuta na jemny **nette-magic hint** (nie cerveny error)
- [ ] `$this['component']` pristup - hint, nie error
- [ ] **Realna chyba** (preklep na normalnej triede, napr. `$emailTemplate->bodyy` na domenovej Email/PdfTemplate triede) - STALE cerveny error (nesmie byt potlacena!)
- [ ] V Laravel projekte laravel-magic hinty funguju ako doteraz (regresia)

## 9. Git Directory Mappings - detekcia a nastavenia

Testuj na attendanceri (hlavny repo + workbench/lcsk/* package repos):
- [ ] Po otvoreni projektu sa **automaticky detekuju nested repos** (Settings - Directory Mappings sekcia: zoznam auto-detected repos oznacenych, plus workspace root)
- [ ] Toggle "Detect repositories automatically" funguje; manualne pridanie mappingu (relativna cesta) + remove; absolutna cesta / `../` sa odmietne
- [ ] Poznamka: zmena manualnych mappings sa prejavi po znovuotvoreni workspace (known follow-up)

## 10. Git multi-repo - Local Changes + COMMIT & PUSH (KRITICKE - user pozadavka)

- [ ] Zmen subory v hlavnom repe AJ v 2 package repoch (workbench/lcsk/x, workbench/lcsk/y) - **Local Changes panel zobrazi 3 skupiny** s repo headermi (nazov + branch + pocet zmien)
- [ ] Single-repo projekt - panel vyzera PRESNE ako predtym (ziadne headery - regresia!)
- [ ] Vyber zmeny naprieč repami checkboxami - **Commit** vytvori commit V KAZDOM dotknutom repe s rovnakou spravou (over `git log` v kazdom repe!)
- [ ] **KOLIZNY TEST**: rovnaky nazov suboru v 2 repoch (napr. README.md v hlavnom aj v package) - vyber LEN jeden - commitne sa LEN ten vybrany (over ze druhy repo NEMA novy commit!)
- [ ] **Commit and Push** - pushne kazdy dotknuty repo; ak jeden push zlyha (napr. repo bez remote), ostatne preidu + zobrazi sa per-repo vysledok ("Push failed for workbench/lcsk/x: ...")
- [ ] Subor sa NIKDY necommitne do nespravneho repa (skontroluj `git log --stat` v hlavnom repe po commite package zmeny)
- [ ] Stage/unstage/revert jednotlivych suborov v nested repe funguje (revert vrati obsah - POZOR destruktivne, testuj na zalohovanej zmene)
- [ ] Per-hunk stage v nested repe (ak hunk UI pouzivas) - poznamka: hunk operacie su plne podporovane pre primary repo; nested hunky over a reportuj

## 11. Git multi-repo - status bar, gutter, blame, history

- [ ] Aktivny subor v package repe - **status bar branch ukazuje branch TOHO repa** (kompaktny label "lcsk/x: main"); subor v hlavnom repe - branch hlavneho
- [ ] Gutter diff (zmenene riadky) v subore package repa - diff proti package repu (nie hlavnemu)
- [ ] Git blame / file history na subore package repa - historia z package repa
- [ ] Prepnutie projektov (attendancer <-> iny) - git stavy sa nemiesaju (izolacia)

## 12. Regresie - Laravel IDE mode

- [ ] `$model->` completion (fillable, casts, DB stlpce, relations, scopes) - funguje ako doteraz
- [ ] Blade: `<x-component>` nav, `$invoice->` z controllera, `@include` nav, route/config/trans helpery
- [ ] `route('`/`config('`/`__('` completion + Cmd+B; validation rules completion
- [ ] Laravel diagnostiky (laravel-magic hinty, ziadne nove false positives)
- [ ] Single-repo git workflow: status, stage, commit, push, stash, branch panel, history - vsetko ako doteraz

## 13. Regresie - light mode + vseobecne

- [ ] JS/TS projekt: nav/rename/hover/completion/auto-import - bez zmeny
- [ ] PHP light mode Cmd+B instantny
- [ ] Runtime cockpit (Cmd+Shift+R): PID/RAM/CPU, restart/stop, latencie - funguje
- [ ] IDE mode on/off - phpactor start/stop cisto; ziadne visiace procesy
- [ ] Vypnutie IDE mode / zatvorenie projektu - Nette cache/stav sa uvolni (ziadny leak pri prepinani)

---

### Priorita testovania (ak je malo casu)

1. **10** (multi-repo commit&push + KOLIZNY test) + **1** (exkluzivita) - jadro novych pozadaviek
2. **4 + 5 + 6** (Latte premenne, {control}, {link} nav - PhpStorm parita)
3. **11** (status bar/gutter/blame per repo) + **9** (mappings settings)
4. **7 + 8** (NEON + diagnostiky) + **2 + 3** (highlighting + nav)
5. **12 + 13** (regresie)
