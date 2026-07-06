/**
 * Pure detection + resolution of Nette `{link}` / `n:href` / `{plink}` presenter
 * links (the signature Nette navigation feature, spec §4.7 / §8).
 *
 * This module answers, for a cursor offset, four questions the application layer
 * needs to wire Cmd+B and `Presenter:action` completion:
 *
 *   1. What does a link TARGET string (`Product:show`, `:Admin:Product:`,
 *      `delete!`, `this`) resolve to structurally? — `parseNetteLinkTarget`.
 *   2. Is the cursor on a Latte link target (`{link ...}`, `{plink ...}`,
 *      `n:href="..."`)? — `detectLatteLinkAt`.
 *   3. Is the cursor on a PHP presenter link target (`$this->link('...')`,
 *      `->redirect('...')`, `->forward('...')`, ...)? — `detectPhpPresenterLinkAt`.
 *   4. Which presenter method names / class file candidates back a parsed
 *      target? — `nettePresenterActionMethodCandidates` /
 *      `nettePresenterClassCandidatePathsForLink`.
 *
 * Plus `nettePresenterLinkCompletionContextAt` for the completion replace-range.
 *
 * Everything here is PURE: no filesystem, no async, no shared state. It stays
 * CONSERVATIVE — any dynamic (`$var`), expression, or otherwise ambiguous target
 * resolves to `null` rather than a guessed navigation. Mapping a candidate path
 * to a real file (and a method candidate to a real method) is the integration
 * layer's job.
 *
 * MASKING is NOT re-implemented here. The `{link}`/`{plink}` detection rides on
 * `latteSyntax.ts`'s `innermostLatteExpressionSpanAt`, whose tag scanner already
 * skips `{* comment *}` and `{syntax off}` regions; the `n:href` detection checks
 * `collectLatteMaskedRegions` directly (the same single-pass scan), so a link
 * written inside a comment is never matched.
 *
 * HANG-SAFETY: every scan is a single bounded pass. The `n:href` backward scan is
 * capped by `MAX_NHREF_SCAN` and stops at a tag/line boundary; the PHP call scan
 * uses only linear, backtracking-free regexes; string/token reads stop at the end
 * of their tag / line / literal. There is no `lastIndexOf` clamping and no match
 * that can straddle the whole document.
 */

import {
  collectLatteMaskedRegions,
  innermostLatteExpressionSpanAt,
} from "./latteSyntax";
import type { LatteMaskedRegion } from "./latteSyntax";
import { presenterCandidatePathsForTemplate } from "./nettePathResolution";

/** The Latte construct that carries a presenter link target. */
export type NetteLatteLinkTag = "link" | "plink" | "n:href";

/** The PHP presenter method whose first string argument is a link target. */
export type NettePhpLinkCall =
  | "link"
  | "redirect"
  | "redirectPermanent"
  | "forward"
  | "lazyLink"
  | "isLinkCurrent"
  | "canonicalize";

/**
 * The structural decomposition of a Nette link destination.
 *
 * - `presenter` is `null` for a RELATIVE target (`show`, `delete!`, `this`) that
 *   resolves against the current presenter; otherwise the presenter short name.
 * - `module` is `null` when the target names no module, else the module path with
 *   `:` separators preserved for nested modules (`Admin:Sales`). Only meaningful
 *   for `absolute` targets in Nette.
 * - `action` is the action name; an empty action (`Product:`) becomes `default`.
 *   The special value `"this"` (with `presenter: null`, `isSignal: false`) is the
 *   CURRENT-ACTION marker — Nette's `this` destination reloads the current
 *   presenter/action, which cannot be named statically here.
 * - `isSignal` is `true` for a `!`-suffixed signal (`delete!`), whose handler is
 *   `handle<Action>`.
 * - `absolute` is `true` for a `:`-prefixed absolute module path.
 */
export interface NetteLinkTarget {
  absolute: boolean;
  action: string;
  isSignal: boolean;
  module: string | null;
  presenter: string | null;
}

/** A detected Latte link target with its source offsets. */
export interface LatteLinkDetection {
  tag: NetteLatteLinkTag;
  target: string;
  targetEnd: number;
  targetStart: number;
}

/** A detected PHP presenter link target with its source offsets. */
export interface PhpPresenterLinkDetection {
  call: NettePhpLinkCall;
  target: string;
  targetEnd: number;
  targetStart: number;
}

/** The replace range for `Presenter:action` completion at a cursor. */
export interface NetteLinkCompletionContext {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_ACTION = "default";
const THIS_ACTION = "this";
const PRESENTER_SUFFIX = "Presenter.php";
const LATTE_EXTENSION = ".latte";

/** Bound for the backward scan that finds an `n:href="` opening quote. */
const MAX_NHREF_SCAN = 4000;

/**
 * Presenter method calls whose FIRST string argument is a link target. Ordered
 * longest-first inside the alternation so `redirectPermanent` is never shadowed
 * by `redirect`; a trailing `\b` rejects lookalikes (`linkGenerator`).
 */
const PHP_LINK_CALL =
  /->\s*(redirectPermanent|redirect|isLinkCurrent|lazyLink|canonicalize|forward|link)\b\s*\(/g;

/**
 * Decomposes a Nette link destination string into its structural parts, or
 * `null` when it is dynamic (`$var`), an expression, or otherwise not a static
 * navigable target. See {@link NetteLinkTarget} for the field contract.
 */
export function parseNetteLinkTarget(target: string): NetteLinkTarget | null {
  const trimmed = target.trim();

  if (trimmed.length === 0 || trimmed.includes("$")) {
    return null;
  }

  let rest = stripFragment(stripLeadingDoubleSlash(trimmed));

  if (rest.length === 0) {
    return null;
  }

  const isSignal = rest.endsWith("!");
  rest = isSignal ? rest.slice(0, -1) : rest;

  if (rest.length === 0) {
    return null;
  }

  const absolute = rest.startsWith(":");
  rest = absolute ? rest.slice(1) : rest;

  if (rest.length === 0) {
    return null;
  }

  const segments = rest.split(":");
  const actionSegment = segments[segments.length - 1] ?? "";
  const presenterSegments = segments.slice(0, -1);

  if (isCurrentActionMarker(actionSegment, presenterSegments, absolute, isSignal)) {
    return relativeTarget(THIS_ACTION, false, false);
  }

  const action = actionSegment.length === 0 ? DEFAULT_ACTION : actionSegment;

  if (!IDENTIFIER.test(action)) {
    return null;
  }

  if (presenterSegments.length === 0) {
    if (absolute) {
      return null;
    }

    return relativeTarget(action, isSignal, absolute);
  }

  for (const segment of presenterSegments) {
    if (!IDENTIFIER.test(segment)) {
      return null;
    }
  }

  const presenter = presenterSegments[presenterSegments.length - 1] ?? null;
  const moduleSegments = presenterSegments.slice(0, -1);

  return {
    absolute,
    action,
    isSignal,
    module: moduleSegments.length > 0 ? moduleSegments.join(":") : null,
    presenter,
  };
}

/**
 * Candidate presenter method names for a parsed action. A signal yields
 * `handle<Action>`; a normal action yields `action<Action>` BEFORE
 * `render<Action>` (Nette lifecycle order). The `this` current-action marker and
 * a blank action cannot be resolved statically and yield `[]`.
 */
export function nettePresenterActionMethodCandidates(
  action: string,
  isSignal: boolean,
): string[] {
  const trimmed = action.trim();

  if (!IDENTIFIER.test(trimmed)) {
    return [];
  }

  const capitalised = ucfirst(trimmed);

  if (isSignal) {
    return [`handle${capitalised}`];
  }

  if (trimmed === THIS_ACTION) {
    return [];
  }

  return [`action${capitalised}`, `render${capitalised}`];
}

/**
 * Candidate presenter class file paths (workspace-relative) for a parsed link
 * target, covering BOTH Nette conventions (modern `app/UI/<Name>/` sibling and
 * classic `app/Presenters/`), plus modular forms. The current file's own
 * convention is emitted first. A RELATIVE target (`presenter: null`) resolves to
 * the current presenter's own class path (directly, or via the template it
 * renders). Conservative: an unusable presenter name or current path yields `[]`.
 *
 * MODULE RESOLUTION mirrors Nette's `Presenter::createRequest`: a target
 * WITHOUT a leading `:` (`!parsed.absolute`) resolves against the CURRENT
 * module, so its module (if any) is a SUFFIX appended after the current one,
 * not the whole story. The current module is derived from
 * `currentRelativePath` (see `detectCurrentModule`) and, when present,
 * prepended to `parsed.module` for a MODULE-AWARE candidate group emitted
 * FIRST. The pre-prepend (project-root) candidate group — i.e. exactly what
 * this function returned before module-awareness existed — is always kept
 * AFTER it as a conservative fallback, since the module heuristic can misread
 * a path in a non-modular project. An ABSOLUTE target (`:Admin:Product:show`)
 * already names its module from the app root, so it is never prepended.
 */
export function nettePresenterClassCandidatePathsForLink(
  parsed: NetteLinkTarget,
  currentRelativePath: string,
): string[] {
  if (parsed.presenter === null) {
    return currentPresenterClassPaths(currentRelativePath);
  }

  const presenter = ucfirst(parsed.presenter);

  if (!IDENTIFIER.test(presenter)) {
    return [];
  }

  const currentClassicModuleBase = currentClassicTemplatePresenterBase(
    currentRelativePath,
  );
  const appRoot = detectAppRoot(currentRelativePath);
  const convention = detectConvention(currentRelativePath);
  const currentClassicModule = parsed.absolute
    ? []
    : currentClassicModulePresenterCandidates(
        presenter,
        parsed.module,
        currentClassicModuleBase,
      );
  const fallback = presenterClassPathsForModule(
    appRoot,
    presenter,
    parsed.module,
    convention,
  );
  const moduleAware = parsed.absolute || currentClassicModuleBase !== null
    ? []
    : moduleAwareCandidates(
        appRoot,
        presenter,
        parsed.module,
        currentRelativePath,
        convention,
      );

  return dedupe(
    [...currentClassicModule, ...moduleAware, ...fallback].filter(
      (path) => path.length > 0,
    ),
  );
}

/**
 * Returns the Latte link target at `offset` — inside a `{link}` / `{plink}` macro
 * or an `n:href="..."` attribute — or `null` when the offset is not on a static
 * link target (dynamic value, wrong tag, masked region, or off the target token).
 */
export function detectLatteLinkAt(
  source: string,
  offset: number,
): LatteLinkDetection | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const macro = latteLinkMacroAt(source, offset);

  if (macro) {
    return macro;
  }

  return latteNHrefLinkAt(source, offset);
}

/**
 * Returns the PHP presenter link target at `offset` — the first string-literal
 * argument of a `$this->link(...)` / `->redirect(...)` / `->forward(...)` /
 * `->lazyLink(...)` / `->isLinkCurrent(...)` / `->redirectPermanent(...)` /
 * `->canonicalize(...)` call — or `null` when the cursor is not on such a target.
 */
export function detectPhpPresenterLinkAt(
  source: string,
  offset: number,
): PhpPresenterLinkDetection | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const call of phpLinkCalls(source)) {
    if (offset < call.contentStart || offset > call.contentEnd) {
      continue;
    }

    if (!isPlausibleLinkToken(call.text)) {
      continue;
    }

    return {
      call: call.name,
      target: call.text,
      targetEnd: call.contentEnd,
      targetStart: call.contentStart,
    };
  }

  return null;
}

/**
 * Returns the completion replace range for the presenter link target at `offset`,
 * or `null` when the cursor is not inside a link target. `kind` selects the Latte
 * (`{link}` / `{plink}` / `n:href`) or PHP (`$this->link(...)`) surface. Unlike
 * `detectLatteLinkAt` this accepts a partial / empty target (the completion is
 * offered WHILE typing).
 */
export function nettePresenterLinkCompletionContextAt(
  source: string,
  offset: number,
  kind: "latte" | "php",
): NetteLinkCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  if (kind === "php") {
    return phpLinkCompletionAt(source, offset);
  }

  return latteLinkCompletionAt(source, offset);
}

// --- link-target parsing helpers -------------------------------------------

function stripLeadingDoubleSlash(value: string): string {
  return value.startsWith("//") ? value.slice(2) : value;
}

function stripFragment(value: string): string {
  const hashIndex = value.indexOf("#");

  return hashIndex >= 0 ? value.slice(0, hashIndex) : value;
}

function isCurrentActionMarker(
  actionSegment: string,
  presenterSegments: readonly string[],
  absolute: boolean,
  isSignal: boolean,
): boolean {
  return (
    actionSegment === THIS_ACTION &&
    presenterSegments.length === 0 &&
    !absolute &&
    !isSignal
  );
}

function relativeTarget(
  action: string,
  isSignal: boolean,
  absolute: boolean,
): NetteLinkTarget {
  return { absolute, action, isSignal, module: null, presenter: null };
}

// --- presenter path helpers -------------------------------------------------

function currentPresenterClassPaths(currentRelativePath: string): string[] {
  const path = normalizeSlashes(currentRelativePath).trim();

  if (path.length === 0) {
    return [];
  }

  if (path.endsWith(PRESENTER_SUFFIX)) {
    return [path];
  }

  if (path.endsWith(LATTE_EXTENSION)) {
    return presenterCandidatePathsForTemplate(path);
  }

  return [];
}

function modernPresenterClassPaths(
  appRoot: string,
  presenter: string,
  module: string | null,
): string[] {
  const moduleDir = module
    ? module.split(":").map(ucfirst).join("/")
    : "";
  const dir = joinSegments([appRoot, "UI", moduleDir, presenter]);

  return [joinRelative(dir, `${presenter}${PRESENTER_SUFFIX}`)];
}

function classicPresenterClassPaths(
  appRoot: string,
  presenter: string,
  module: string | null,
): string[] {
  const file = `${presenter}${PRESENTER_SUFFIX}`;

  if (!module) {
    return [joinRelative(joinSegments([appRoot, "Presenters"]), file)];
  }

  const moduleDir = module
    .split(":")
    .map((segment) => `${ucfirst(segment)}Module`)
    .join("/");

  return [
    joinRelative(joinSegments([appRoot, moduleDir, "presenters"]), file),
    joinRelative(joinSegments([appRoot, moduleDir, "Presenters"]), file),
  ];
}

function currentClassicModulePresenterCandidates(
  presenter: string,
  targetModule: string | null,
  base: string | null,
): string[] {
  if (base === null) {
    return [];
  }

  const moduleBase = targetModule
    ? joinSegments([
        base,
        ...targetModule.split(":").map((segment) => `${ucfirst(segment)}Module`),
      ])
    : base;

  return classicPresenterClassPathsFromBase(moduleBase, presenter);
}

/**
 * Classic module template convention used by older Nette apps:
 * `app/modules/productsModule/templates/ProductsAdmin/default.latte` maps back
 * to `app/modules/productsModule/Presenters/ProductsAdminPresenter.php`.
 */
function currentClassicTemplatePresenterBase(
  currentRelativePath: string,
): string | null {
  const path = normalizeSlashes(currentRelativePath).trim();
  const marker = "/templates/";
  const templatesIndex = path.indexOf(marker);

  if (templatesIndex < 0 || !path.endsWith(LATTE_EXTENSION)) {
    return null;
  }

  const base = path.slice(0, templatesIndex);
  const afterTemplates = path.slice(templatesIndex + marker.length);
  const presenterSegment = afterTemplates.split("/")[0] ?? "";

  if (
    base.length === 0 ||
    !isClassicModuleBase(base) ||
    !IDENTIFIER.test(presenterSegment)
  ) {
    return null;
  }

  return base;
}

function isClassicModuleBase(path: string): boolean {
  return basenameOf(path).endsWith("Module");
}

function classicPresenterClassPathsFromBase(
  presenterBase: string,
  presenter: string,
): string[] {
  const file = `${presenter}${PRESENTER_SUFFIX}`;

  if (basenameOf(presenterBase).toLowerCase() === "presenters") {
    return [joinRelative(presenterBase, file)];
  }

  return [
    joinRelative(presenterBase, `Presenters/${file}`),
    joinRelative(presenterBase, `presenters/${file}`),
    joinRelative(presenterBase, file),
  ];
}

/**
 * Derives the application root directory from the current file's path — the
 * segment just before the first `UI` / `Presenters` / `presenters` / `*Module`
 * convention marker. Falls back to `app` (the Nette default) when no marker is
 * present.
 */
function detectAppRoot(currentRelativePath: string): string {
  const segments = normalizeSlashes(currentRelativePath)
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0);

  for (let index = 0; index < segments.length; index += 1) {
    if (
      segments[index]?.endsWith("Module") &&
      segments[index - 1]?.toLowerCase() === "modules"
    ) {
      return segments.slice(0, index - 1).join("/");
    }

    if (isConventionMarker(segments[index] ?? "")) {
      return segments.slice(0, index).join("/");
    }
  }

  return "app";
}

function isConventionMarker(segment: string): boolean {
  return (
    segment === "UI" ||
    segment === "Presenters" ||
    segment === "presenters" ||
    segment.endsWith("Module")
  );
}

function detectConvention(
  currentRelativePath: string,
): "modern" | "classic" | null {
  const path = normalizeSlashes(currentRelativePath).trim();

  if (path.includes("/UI/") || path.startsWith("UI/")) {
    return "modern";
  }

  if (
    path.includes("/Presenters/") ||
    path.startsWith("Presenters/") ||
    path.includes("/presenters/") ||
    /(?:^|\/)[A-Za-z0-9_]+Module\//.test(path)
  ) {
    return "classic";
  }

  return null;
}

/** Both presenter-class candidate paths for one module, in convention order. */
function presenterClassPathsForModule(
  appRoot: string,
  presenter: string,
  module: string | null,
  convention: "modern" | "classic" | null,
): string[] {
  const modern = modernPresenterClassPaths(appRoot, presenter, module);
  const classic = classicPresenterClassPaths(appRoot, presenter, module);

  return convention === "classic" ? [...classic, ...modern] : [...modern, ...classic];
}

/**
 * The module-aware candidate group for a RELATIVE target: the current file's
 * module (if any) prepended to `targetModule`. Returns `[]` when no current
 * module can be derived — a non-modular project has nothing to prepend, and
 * the plain `presenterClassPathsForModule` fallback already covers that case.
 */
function moduleAwareCandidates(
  appRoot: string,
  presenter: string,
  targetModule: string | null,
  currentRelativePath: string,
  convention: "modern" | "classic" | null,
): string[] {
  const currentModule = detectCurrentModule(currentRelativePath, convention);

  if (currentModule === null) {
    return [];
  }

  const combinedModule = targetModule
    ? `${currentModule}:${targetModule}`
    : currentModule;

  return presenterClassPathsForModule(appRoot, presenter, combinedModule, convention);
}

/**
 * Derives the CURRENT module (`:`-joined, e.g. `Admin:Sales`) from the current
 * file's path, or `null` when the project isn't modular / no convention was
 * detected. Mirrors both conventions:
 *
 * - modern: `app/UI/<Module...>/<PresenterDir>/<file>` — everything between
 *   the `UI` marker and the presenter's own directory is the module path
 *   (`app/UI/Admin/Dashboard/default.latte` → `Admin`).
 * - classic: every `*Module` ancestor directory, suffix stripped, in path
 *   order (`app/AdminModule/SalesModule/presenters/X.php` → `Admin:Sales`).
 */
function detectCurrentModule(
  currentRelativePath: string,
  convention: "modern" | "classic" | null,
): string | null {
  const segments = normalizeSlashes(currentRelativePath)
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0);

  if (convention === "classic") {
    return detectCurrentModuleClassic(segments);
  }

  if (convention === "modern") {
    return detectCurrentModuleModern(segments);
  }

  return null;
}

function detectCurrentModuleModern(segments: string[]): string | null {
  const uiIndex = segments.indexOf("UI");

  if (uiIndex < 0) {
    return null;
  }

  // Drop `UI` itself and the trailing filename; what remains is
  // `[...moduleSegments, presenterDir]` — a lone presenter dir means no module.
  const afterUi = segments.slice(uiIndex + 1, -1);

  if (afterUi.length <= 1) {
    return null;
  }

  return afterUi.slice(0, -1).join(":");
}

function detectCurrentModuleClassic(segments: string[]): string | null {
  const moduleSegments = segments
    .filter((segment) => segment.endsWith("Module"))
    .map((segment) => segment.slice(0, -"Module".length));

  return moduleSegments.length > 0 ? moduleSegments.join(":") : null;
}

// --- Latte detection --------------------------------------------------------

/**
 * KNOWN GAP (intentional, not fixed here): `innermostLatteExpressionSpanAt`
 * (see `latteSyntax.ts`'s `findLatteTagClose`) is LINE-BOUNDED — it stops a
 * tag's content at the first `\n`. A `{link}` / `{plink}` macro whose target
 * is split across lines (`{link Product:\n  show}`) is therefore not detected
 * past the line break. Real-world `{link}` usage is single-line, so this is a
 * safe, conservative miss rather than a wrong navigation.
 */
function latteLinkMacroAt(
  source: string,
  offset: number,
): LatteLinkDetection | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span || (span.tagName !== "link" && span.tagName !== "plink")) {
    return null;
  }

  const token = readTargetToken(source, span.expressionStart, span.contentEnd);

  if (!token || offset < token.start || offset > token.end) {
    return null;
  }

  return {
    tag: span.tagName,
    target: token.text,
    targetEnd: token.end,
    targetStart: token.start,
  };
}

/**
 * KNOWN GAP (intentional, not fixed here): this matches `n:href="..."` as a
 * textual pattern, not a parsed HTML attribute. Free-floating text that
 * happens to read like an `n:href` attribute outside real markup — e.g. a
 * code sample embedded in prose, `{* like n:href="X" *}` gets masked, but an
 * UNCOMMENTED prose mention would not — can still match. Full HTML-attribute
 * parsing is out of scope for this module; `isPrecededByNHref`'s boundary
 * check (whitespace / `<` / start-of-scan) keeps the common false positive
 * (`data-n:href="..."`) out, which covers the realistic case.
 */
function latteNHrefLinkAt(
  source: string,
  offset: number,
): LatteLinkDetection | null {
  if (isInsideLatteMask(source, offset)) {
    return null;
  }

  const value = nHrefValueAt(source, offset);

  if (!value) {
    return null;
  }

  const token = readTargetToken(source, value.valueStart, value.valueEnd);

  if (!token || offset < token.start || offset > token.end) {
    return null;
  }

  return {
    tag: "n:href",
    target: token.text,
    targetEnd: token.end,
    targetStart: token.start,
  };
}

interface NHrefValue {
  valueEnd: number;
  valueStart: number;
}

/**
 * If `offset` lies inside the value of an `n:href="..."` / `n:href='...'`
 * attribute, returns the value bounds. Bounded backward scan (capped by
 * `MAX_NHREF_SCAN`, stops at a `<` / `>` / newline boundary): the first quote
 * found going back must be the OPENING quote (immediately preceded by
 * `n:href=`), otherwise the offset is not directly inside an `n:href` value.
 */
function nHrefValueAt(source: string, offset: number): NHrefValue | null {
  const min = Math.max(0, offset - MAX_NHREF_SCAN);

  for (let index = offset - 1; index >= min; index -= 1) {
    const character = source[index];

    if (character === "\n" || character === "<" || character === ">") {
      return null;
    }

    if (character !== '"' && character !== "'") {
      continue;
    }

    if (!isPrecededByNHref(source, index)) {
      return null;
    }

    const valueStart = index + 1;
    const valueEnd = attributeValueEnd(source, valueStart, character);

    if (offset < valueStart || offset > valueEnd) {
      return null;
    }

    return { valueEnd, valueStart };
  }

  return null;
}

/**
 * Requires a boundary (whitespace, `<`, or the start of the scan window)
 * immediately before `n:href` so a lookalike attribute name — `data-n:href`,
 * `x-n:href`, ... — is never mistaken for the real Latte `n:href`.
 */
function isPrecededByNHref(source: string, quoteIndex: number): boolean {
  const windowStart = Math.max(0, quoteIndex - 40);

  return /(?:^|[\s<])n:href\s*=\s*$/.test(source.slice(windowStart, quoteIndex));
}

function attributeValueEnd(
  source: string,
  valueStart: number,
  quote: string,
): number {
  for (let index = valueStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === quote || character === "\n" || character === ">") {
      return index;
    }
  }

  return source.length;
}

// --- PHP detection ----------------------------------------------------------

interface PhpLinkCall {
  contentEnd: number;
  contentStart: number;
  name: NettePhpLinkCall;
  text: string;
}

function phpLinkCalls(source: string): PhpLinkCall[] {
  const calls: PhpLinkCall[] = [];

  PHP_LINK_CALL.lastIndex = 0;

  for (
    let match = PHP_LINK_CALL.exec(source);
    match !== null;
    match = PHP_LINK_CALL.exec(source)
  ) {
    const openParen = match.index + match[0].length - 1;
    const literal = firstStringLiteralArgument(source, openParen);

    if (PHP_LINK_CALL.lastIndex <= match.index) {
      PHP_LINK_CALL.lastIndex = match.index + 1;
    }

    if (!literal) {
      continue;
    }

    calls.push({
      contentEnd: literal.contentEnd,
      contentStart: literal.contentStart,
      name: match[1] as NettePhpLinkCall,
      text: literal.text,
    });
  }

  return calls;
}

interface StringLiteral {
  contentEnd: number;
  contentStart: number;
  text: string;
}

/**
 * Reads the FIRST argument and requires it to be a string literal.
 *
 * KNOWN GAP (intentional, not fixed here): the legacy
 * `redirect(302, 'Presenter:action')` HTTP-status-code overload puts the
 * target in the SECOND argument, so this always returns `null` for it and the
 * link is silently not detected. This is a deprecated Nette form; treating
 * argument position generically (rather than "first argument only") would
 * complicate every call site for a form real projects rarely use. Safe
 * degradation: no navigation offered, never a wrong one.
 */
function firstStringLiteralArgument(
  source: string,
  openParen: number,
): StringLiteral | null {
  let index = openParen + 1;

  while (index < source.length && isWhitespace(source[index])) {
    index += 1;
  }

  const quote = source[index];

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const contentStart = index + 1;
  const contentEnd = stringLiteralClose(source, contentStart, quote);

  return {
    contentEnd,
    contentStart,
    text: source.slice(contentStart, contentEnd),
  };
}

function stringLiteralClose(
  source: string,
  contentStart: number,
  quote: string,
): number {
  let index = contentStart;

  while (index < source.length) {
    const character = source[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return index;
    }

    index += 1;
  }

  return source.length;
}

// --- completion contexts ----------------------------------------------------

function latteLinkCompletionAt(
  source: string,
  offset: number,
): NetteLinkCompletionContext | null {
  const nHref = nHrefCompletionAt(source, offset);

  if (nHref) {
    return nHref;
  }

  return latteMacroCompletionAt(source, offset);
}

function nHrefCompletionAt(
  source: string,
  offset: number,
): NetteLinkCompletionContext | null {
  if (isInsideLatteMask(source, offset)) {
    return null;
  }

  const value = nHrefValueAt(source, offset);

  if (!value) {
    return null;
  }

  const region = targetTokenRegion(
    source,
    value.valueStart,
    value.valueEnd,
  );

  return completionInRegion(source, offset, region);
}

function latteMacroCompletionAt(
  source: string,
  offset: number,
): NetteLinkCompletionContext | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span || (span.tagName !== "link" && span.tagName !== "plink")) {
    return null;
  }

  const region = targetTokenRegion(source, span.expressionStart, span.contentEnd);

  return completionInRegion(source, offset, region);
}

function phpLinkCompletionAt(
  source: string,
  offset: number,
): NetteLinkCompletionContext | null {
  for (const call of phpLinkCalls(source)) {
    if (offset < call.contentStart || offset > call.contentEnd) {
      continue;
    }

    return {
      prefix: source.slice(call.contentStart, offset),
      replaceEnd: call.contentEnd,
      replaceStart: call.contentStart,
    };
  }

  return null;
}

interface TokenRegion {
  end: number;
  start: number;
}

function completionInRegion(
  source: string,
  offset: number,
  region: TokenRegion,
): NetteLinkCompletionContext | null {
  if (offset < region.start || offset > region.end) {
    return null;
  }

  return {
    prefix: source.slice(region.start, offset),
    replaceEnd: region.end,
    replaceStart: region.start,
  };
}

// --- token reading ----------------------------------------------------------

interface TargetToken {
  end: number;
  start: number;
  text: string;
}

/**
 * Reads the first link-target token in `[from, limit)`: a quoted literal's inner
 * text, or a bare token up to the first whitespace / comma. Returns `null` when
 * the token is empty or not a plausible static target.
 */
function readTargetToken(
  source: string,
  from: number,
  limit: number,
): TargetToken | null {
  const region = targetTokenRegion(source, from, limit);
  const text = source.slice(region.start, region.end);

  if (!isPlausibleLinkToken(text)) {
    return null;
  }

  return { end: region.end, start: region.start, text };
}

function targetTokenRegion(
  source: string,
  from: number,
  limit: number,
): TokenRegion {
  let index = skipInlineWhitespace(source, from, limit);
  const quote = source[index];

  if (index < limit && (quote === "'" || quote === '"')) {
    const start = index + 1;
    let end = start;

    while (end < limit && source[end] !== quote) {
      end = source[end] === "\\" ? end + 2 : end + 1;
    }

    return { end: Math.min(end, limit), start };
  }

  const start = index;

  while (index < limit && !isBareTargetBoundary(source[index])) {
    index += 1;
  }

  return { end: index, start };
}

function isPlausibleLinkToken(text: string): boolean {
  if (text.length === 0 || text.includes("$")) {
    return false;
  }

  return !text.includes("(") && !text.includes(")") && !text.includes("{");
}

// --- masking ----------------------------------------------------------------

function isInsideLatteMask(source: string, offset: number): boolean {
  return collectLatteMaskedRegions(source, offset).some((region) =>
    isOffsetInsideMask(offset, region),
  );
}

function isOffsetInsideMask(offset: number, region: LatteMaskedRegion): boolean {
  return offset > region.start && (offset < region.end || !region.closed);
}

// --- small string / path utilities -----------------------------------------

function skipInlineWhitespace(
  source: string,
  from: number,
  limit: number,
): number {
  let index = from;

  while (index < limit && isInlineWhitespace(source[index])) {
    index += 1;
  }

  return index;
}

function isInlineWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function isWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function isBareTargetBoundary(character: string | undefined): boolean {
  return isWhitespace(character) || character === ",";
}

function normalizeSlashes(path: string): string {
  return path.split("\\").join("/");
}

function joinSegments(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("/");
}

function joinRelative(dir: string, tail: string): string {
  return dir.length > 0 ? `${dir}/${tail}` : tail;
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return path;
  }

  return path.slice(index + 1);
}

function ucfirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }

    seen.add(path);
    result.push(path);
  }

  return result;
}
