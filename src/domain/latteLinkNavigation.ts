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
 * MASKING is NOT re-implemented here. Single-line `{link}`/`{plink}` detection
 * rides on `latteSyntax.ts`'s `innermostLatteExpressionSpanAt`, whose tag scanner
 * already skips `{* comment *}` and `{syntax off}` regions. Multi-line
 * `{link}`/`{plink}` targets use a small, bounded link-only scanner after that
 * general scanner has ruled out "cursor is inside another Latte expression".
 * `n:href` detection checks `collectLatteMaskedRegions` directly (the same
 * single-pass scan), so a link written inside a comment is never matched.
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

/** A static presenter/action target discovered from a Nette Route default. */
export interface NetteRoutePresenterTarget {
  target: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_ACTION = "default";
const THIS_ACTION = "this";
const PRESENTER_SUFFIX = "Presenter.php";
const LATTE_EXTENSION = ".latte";

/** Bound for the backward scan that finds an `n:href="` opening quote. */
const MAX_NHREF_SCAN = 4000;
/** Bound for the backward/forward scan that finds a multi-line `{link}` macro. */
const MAX_LATTE_LINK_MACRO_SCAN = 4000;

/**
 * Presenter method calls whose FIRST string argument is a link target. Ordered
 * longest-first inside the alternation so `redirectPermanent` is never shadowed
 * by `redirect`; a trailing `\b` rejects lookalikes (`linkGenerator`).
 */
const PHP_LINK_CALL =
  /->\s*(redirectPermanent|redirect|isLinkCurrent|lazyLink|canonicalize|forward|link)\b\s*\(/g;
const PHP_ROUTE_CONSTRUCTOR =
  /\bnew\s+(?:\\?Nette\\Application\\Routers\\)?Route\s*\(/g;
const PHP_EXTENSION = ".php";
const PRESENTER_LINK_METHOD =
  /\bfunction\s+&?(action|render|handle)([A-Z][A-Za-z0-9_]*)\s*\(/g;

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

  const currentClassicModuleBase = currentClassicModulePresenterBase(
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
  const absoluteClassicModules = parsed.absolute
    ? absoluteClassicModulesPresenterCandidates(
        presenter,
        parsed.module,
        currentRelativePath,
      )
    : [];
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
    [
      ...currentClassicModule,
      ...absoluteClassicModules,
      ...moduleAware,
      ...fallback,
    ].filter(
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
 * Returns every static Latte presenter link target in document order.
 *
 * The same token reader as `detectLatteLinkAt` decides what is static, so
 * dynamic destinations (`$dest`, expressions, etc.) are skipped consistently.
 */
export function detectLatteLinks(source: string): LatteLinkDetection[] {
  const maskedRegions = collectLatteMaskedRegions(source);
  const detections = [
    ...latteLinkMacroDetections(source, maskedRegions),
    ...latteNHrefLinkDetections(source, maskedRegions),
  ];

  detections.sort((left, right) => left.targetStart - right.targetStart);

  return dedupeLatteLinkDetections(detections);
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

/**
 * Extracts static `Presenter:action` defaults from Nette route definitions:
 * `new Route('/x', 'Product:show')` and
 * `new Route('/x', ['presenter' => 'Product', 'action' => 'show'])`.
 *
 * This is intentionally conservative route awareness for completion discovery:
 * it does not try to evaluate dynamic route masks, constants, variables, or
 * factories. A malformed/default-less route simply contributes no target.
 */
export function netteRoutePresenterTargetsFromSource(
  source: string,
): NetteRoutePresenterTarget[] {
  const targets = new Set<string>();

  PHP_ROUTE_CONSTRUCTOR.lastIndex = 0;

  for (
    let match = PHP_ROUTE_CONSTRUCTOR.exec(source);
    match !== null;
    match = PHP_ROUTE_CONSTRUCTOR.exec(source)
  ) {
    const openParen = match.index + match[0].length - 1;
    const secondArgument = secondTopLevelArgument(source, openParen);

    if (PHP_ROUTE_CONSTRUCTOR.lastIndex <= match.index) {
      PHP_ROUTE_CONSTRUCTOR.lastIndex = match.index + 1;
    }

    if (!secondArgument) {
      continue;
    }

    const target =
      routeStringTarget(source, secondArgument.start, secondArgument.end) ??
      routeArrayTarget(source, secondArgument.start, secondArgument.end);

    if (target) {
      targets.add(target);
    }
  }

  return Array.from(targets)
    .sort((left, right) => left.localeCompare(right))
    .map((target) => ({ target }));
}

export function nettePresenterLinkTargetsFromSource(
  presenterPath: string,
  source: string,
): string[] {
  const shortName = nettePresenterShortNameFromPath(presenterPath);
  const routeTargets = netteRoutePresenterTargetsFromSource(source).map(
    (target) => target.target,
  );

  if (!shortName) {
    return routeTargets;
  }

  const targets: string[] = [];

  for (const match of source.matchAll(PRESENTER_LINK_METHOD)) {
    const kind = match[1] ?? "";
    const rest = match[2] ?? "";
    const action = rest.charAt(0).toLowerCase() + rest.slice(1);

    targets.push(
      kind === "handle"
        ? `${shortName}:${action}!`
        : `${shortName}:${action}`,
    );
  }

  return [...targets, ...routeTargets];
}

export function isNettePresenterDiscoverySourcePath(path: string): boolean {
  const fileName = path.split("/").pop() ?? "";

  return (
    path.endsWith(PRESENTER_SUFFIX) ||
    (/router/i.test(fileName) && fileName.endsWith(PHP_EXTENSION))
  );
}

export function nettePresenterShortNameFromPath(
  presenterPath: string,
): string | null {
  const fileName = presenterPath.split("/").pop() ?? "";

  if (!fileName.endsWith(PRESENTER_SUFFIX)) {
    return null;
  }

  const shortName = fileName.slice(0, -PRESENTER_SUFFIX.length);

  return shortName.length > 0 ? shortName : null;
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

function absoluteClassicModulesPresenterCandidates(
  presenter: string,
  targetModule: string | null,
  currentRelativePath: string,
): string[] {
  if (!targetModule) {
    return [];
  }

  const modulesRoot = currentClassicModulesRoot(currentRelativePath);

  if (modulesRoot === null) {
    return [];
  }

  const moduleBase = joinSegments([
    modulesRoot,
    ...targetModule
      .split(":")
      .map((segment) => `${lcfirst(segment)}Module`),
  ]);

  return classicPresenterClassPathsFromBase(moduleBase, presenter);
}

function currentClassicModulesRoot(currentRelativePath: string): string | null {
  const segments = normalizeSlashes(currentRelativePath)
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0);
  const modulesIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "modules",
  );

  if (modulesIndex < 0) {
    return null;
  }

  const moduleSegment = segments[modulesIndex + 1] ?? "";

  if (!isClassicModuleBase(moduleSegment)) {
    return null;
  }

  return segments.slice(0, modulesIndex + 1).join("/");
}

/**
 * Classic module convention used by older Nette apps:
 * `app/modules/productsModule/templates/ProductsAdmin/default.latte` maps back
 * to `app/modules/productsModule/Presenters/ProductsAdminPresenter.php`.
 * The same module root is used when Cmd+B runs from a presenter under
 * `app/modules/productsModule/Presenters/*Presenter.php`, so relative
 * presenter links stay inside the current module instead of falling back to
 * root-level `app/ProductsModule/...` candidates.
 */
function currentClassicModulePresenterBase(
  currentRelativePath: string,
): string | null {
  const path = normalizeSlashes(currentRelativePath).trim();

  return (
    currentClassicTemplatePresenterBase(path) ??
    currentClassicModulesPresenterBase(path)
  );
}

function currentClassicTemplatePresenterBase(path: string): string | null {
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

function currentClassicModulesPresenterBase(path: string): string | null {
  if (!path.endsWith(PRESENTER_SUFFIX)) {
    return null;
  }

  const segments = path.split("/").filter((segment) => segment.length > 0);
  const presenterDirIndex = segments.length - 2;
  const presenterDir = segments[presenterDirIndex] ?? "";

  if (presenterDir !== "Presenters" && presenterDir !== "presenters") {
    return null;
  }

  const moduleIndex = presenterDirIndex - 1;
  const moduleSegment = segments[moduleIndex] ?? "";

  if (
    segments[moduleIndex - 1]?.toLowerCase() !== "modules" ||
    !isClassicModuleBase(moduleSegment)
  ) {
    return null;
  }

  return segments.slice(0, moduleIndex + 1).join("/");
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

function latteLinkMacroAt(
  source: string,
  offset: number,
): LatteLinkDetection | null {
  const span = latteLinkMacroSpanAt(source, offset);

  if (!span) {
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

function latteLinkMacroDetections(
  source: string,
  maskedRegions: readonly LatteMaskedRegion[],
): LatteLinkDetection[] {
  const detections: LatteLinkDetection[] = [];
  let index = 0;
  let maskIndex = 0;

  while (index < source.length) {
    const openBrace = source.indexOf("{", index);

    if (openBrace < 0) {
      break;
    }

    maskIndex = nextMaskIndexForOffset(maskedRegions, openBrace, maskIndex);
    const mask = maskedRegions[maskIndex];

    if (mask && maskCoversOffset(mask, openBrace)) {
      index = Math.max(openBrace + 1, mask.end);
      continue;
    }

    const parsed = parseLatteLinkMacroOpening(source, openBrace);

    if (!parsed) {
      index = nextIndexAfterNonLinkBrace(source, openBrace);
      continue;
    }

    const contentEnd = findMultilineLatteMacroClose(
      source,
      parsed.expressionStart,
      openBrace + MAX_LATTE_LINK_MACRO_SCAN,
    );
    const token = readTargetToken(source, parsed.expressionStart, contentEnd);

    if (token) {
      detections.push({
        tag: parsed.tagName,
        target: token.text,
        targetEnd: token.end,
        targetStart: token.start,
      });
    }

    index = Math.max(openBrace + 1, contentEnd + 1);
  }

  return detections;
}

function nextIndexAfterNonLinkBrace(source: string, openBrace: number): number {
  if (!isPotentialLatteExpressionOpening(source, openBrace)) {
    return openBrace + 1;
  }

  const contentEnd = findMultilineLatteMacroClose(
    source,
    openBrace + 1,
    openBrace + MAX_LATTE_LINK_MACRO_SCAN,
  );

  return Math.max(openBrace + 1, contentEnd + 1);
}

interface LatteLinkMacroSpan {
  contentEnd: number;
  expressionStart: number;
  tagName: "link" | "plink";
}

function latteLinkMacroSpanAt(
  source: string,
  offset: number,
): LatteLinkMacroSpan | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (span?.tagName === "link" || span?.tagName === "plink") {
    return {
      contentEnd: span.contentEnd,
      expressionStart: span.expressionStart,
      tagName: span.tagName,
    };
  }

  if (span) {
    return null;
  }

  return multilineLatteLinkMacroSpanAt(source, offset);
}

function multilineLatteLinkMacroSpanAt(
  source: string,
  offset: number,
): LatteLinkMacroSpan | null {
  if (isInsideLatteMask(source, offset)) {
    return null;
  }

  const scanStart = Math.max(0, offset - MAX_LATTE_LINK_MACRO_SCAN);

  for (let index = offset; index >= scanStart; index -= 1) {
    if (source[index] !== "{") {
      continue;
    }

    const parsed = parseLatteLinkMacroOpening(source, index);

    if (!parsed) {
      continue;
    }

    const contentEnd = findMultilineLatteMacroClose(
      source,
      parsed.expressionStart,
      index + MAX_LATTE_LINK_MACRO_SCAN,
    );

    if (offset < parsed.expressionStart || offset > contentEnd) {
      continue;
    }

    return {
      contentEnd,
      expressionStart: parsed.expressionStart,
      tagName: parsed.tagName,
    };
  }

  return null;
}

function parseLatteLinkMacroOpening(
  source: string,
  openBrace: number,
): ParsedLatteLinkMacroOpening | null {
  let index = openBrace + 1;
  const tagStart = index;

  while (isAsciiLetter(source[index])) {
    index += 1;
  }

  const tagName = source.slice(tagStart, index);

  if (tagName !== "link" && tagName !== "plink") {
    return null;
  }

  const boundary = source[index];

  if (
    boundary !== undefined &&
    boundary !== "}" &&
    !isWhitespace(boundary)
  ) {
    return null;
  }

  return {
    expressionStart: skipWhitespace(source, index, source.length),
    tagName,
  };
}

interface ParsedLatteLinkMacroOpening {
  expressionStart: number;
  tagName: "link" | "plink";
}

function findMultilineLatteMacroClose(
  source: string,
  from: number,
  maxExclusive: number,
): number {
  const limit = Math.min(source.length, maxExclusive);
  let index = from;
  let quote: string | null = null;
  let depth = 0;

  while (index < limit) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }

    if (character === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "}") {
      if (depth === 0) {
        return index;
      }

      depth -= 1;
      index += 1;
      continue;
    }

    index += 1;
  }

  return limit;
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

function latteNHrefLinkDetections(
  source: string,
  maskedRegions: readonly LatteMaskedRegion[],
): LatteLinkDetection[] {
  const detections: LatteLinkDetection[] = [];
  const attribute = /\bn:href\s*=\s*(['"])/g;
  let maskIndex = 0;

  for (
    let match = attribute.exec(source);
    match !== null;
    match = attribute.exec(source)
  ) {
    const quoteIndex = match.index + match[0].length - 1;
    maskIndex = nextMaskIndexForOffset(maskedRegions, match.index, maskIndex);
    const mask = maskedRegions[maskIndex];

    if (mask && maskCoversOffset(mask, match.index)) {
      attribute.lastIndex = Math.max(attribute.lastIndex, mask.end);
      continue;
    }

    if (!isPrecededByNHref(source, quoteIndex)) {
      continue;
    }

    const valueStart = quoteIndex + 1;
    const valueEnd = attributeValueEnd(source, valueStart, match[1] ?? "");
    const token = readTargetToken(source, valueStart, valueEnd);

    if (!token) {
      continue;
    }

    detections.push({
      tag: "n:href",
      target: token.text,
      targetEnd: token.end,
      targetStart: token.start,
    });
  }

  return detections;
}

function dedupeLatteLinkDetections(
  detections: readonly LatteLinkDetection[],
): LatteLinkDetection[] {
  const seen = new Set<string>();
  const deduped: LatteLinkDetection[] = [];

  for (const detection of detections) {
    const key = `${detection.targetStart}:${detection.targetEnd}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(detection);
  }

  return deduped;
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
    const name = match[1] as NettePhpLinkCall;
    const literal =
      name === "redirect" || name === "redirectPermanent"
        ? redirectStringLiteralArgument(source, openParen)
        : firstStringLiteralArgument(source, openParen);

    if (PHP_LINK_CALL.lastIndex <= match.index) {
      PHP_LINK_CALL.lastIndex = match.index + 1;
    }

    if (!literal) {
      continue;
    }

    calls.push({
      contentEnd: literal.contentEnd,
      contentStart: literal.contentStart,
      name,
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
 * The legacy `redirect(302, 'Presenter:action')` HTTP-status-code overload puts
 * the target in the SECOND argument. We keep the generic rule first-argument-only
 * for every call, then let redirect-like calls opt into that one conservative
 * numeric-status overload.
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

function redirectStringLiteralArgument(
  source: string,
  openParen: number,
): StringLiteral | null {
  const first = firstStringLiteralArgument(source, openParen);

  if (first) {
    return first;
  }

  const second = secondTopLevelArgument(source, openParen);

  if (!second || !firstRedirectArgumentIsStatusCode(source, openParen, second)) {
    return null;
  }

  const quote = source[second.start];

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const literal = firstStringLiteralArgument(source, second.start - 1);

  if (!literal || literal.contentEnd > second.end) {
    return null;
  }

  return literal;
}

function firstRedirectArgumentIsStatusCode(
  source: string,
  openParen: number,
  secondArgument: ArgumentRange,
): boolean {
  const comma = firstTopLevelComma(source, openParen + 1, secondArgument.start);

  if (comma === null) {
    return false;
  }

  const firstRange = trimRange(source, openParen + 1, comma);
  const firstArgument = source.slice(firstRange.start, firstRange.end);

  return /^[1-5][0-9]{2}$/.test(firstArgument);
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

interface ArgumentRange {
  end: number;
  start: number;
}

function secondTopLevelArgument(
  source: string,
  openParen: number,
): ArgumentRange | null {
  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const comma = firstTopLevelComma(source, openParen + 1, closeParen);

  if (comma === null) {
    return null;
  }

  const start = skipWhitespace(source, comma + 1, closeParen);
  const end = topLevelArgumentEnd(source, start, closeParen);

  return start < end ? { end, start } : null;
}

function firstTopLevelComma(
  source: string,
  start: number,
  end: number,
): number | null {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: string | null = null;
  let index = start;

  while (index < end) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
    }

    if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }

    if (char === "[") {
      bracketDepth += 1;
    }

    if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    }

    if (char === "{") {
      braceDepth += 1;
    }

    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    }

    if (
      char === "," &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }

    index += 1;
  }

  return null;
}

function topLevelArgumentEnd(
  source: string,
  start: number,
  limit: number,
): number {
  const comma = firstTopLevelComma(source, start, limit);
  let end = comma ?? limit;

  while (end > start && isWhitespace(source[end - 1])) {
    end -= 1;
  }

  return end;
}

function routeStringTarget(
  source: string,
  start: number,
  end: number,
): string | null {
  const quote = source[start];

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const literal = firstStringLiteralArgument(source, start - 1);

  if (!literal || literal.contentEnd > end) {
    return null;
  }

  return completionTargetFromLinkLiteral(literal.text);
}

function routeArrayTarget(
  source: string,
  start: number,
  end: number,
): string | null {
  if (source[start] !== "[") {
    return null;
  }

  const closeBracket = matchingBracketOffset(source, start, "[", "]");

  if (closeBracket === null || closeBracket > end) {
    return null;
  }

  const arraySource = source.slice(start, closeBracket + 1);
  const presenter = routeArrayStringValue(arraySource, "presenter");
  const action = routeArrayStringValue(arraySource, "action") ?? DEFAULT_ACTION;

  if (!presenter) {
    return null;
  }

  return completionTargetFromLinkLiteral(`${presenter}:${action}`);
}

function routeArrayStringValue(arraySource: string, key: string): string | null {
  const pattern = new RegExp(
    String.raw`(['"])${escapeRegExp(key)}\1\s*=>\s*(['"])(.*?)\2`,
    "s",
  );
  const match = pattern.exec(arraySource);

  return match?.[3] ?? null;
}

function completionTargetFromLinkLiteral(target: string): string | null {
  const parsed = parseNetteLinkTarget(target);

  if (!parsed || parsed.presenter === null) {
    return null;
  }

  return [
    parsed.module,
    parsed.presenter,
    `${parsed.action}${parsed.isSignal ? "!" : ""}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(":");
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  if (source[openOffset] !== open) {
    return null;
  }

  let depth = 0;
  let quote: string | null = null;
  let index = openOffset;

  while (index < source.length) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }

    index += 1;
  }

  return null;
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
  const span = latteLinkMacroSpanAt(source, offset);

  if (!span) {
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
  let index = skipWhitespace(source, from, limit);
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

function nextMaskIndexForOffset(
  regions: readonly LatteMaskedRegion[],
  offset: number,
  fromIndex: number,
): number {
  let index = fromIndex;

  while (index < regions.length && regions[index].end <= offset) {
    index += 1;
  }

  return index;
}

function maskCoversOffset(region: LatteMaskedRegion, offset: number): boolean {
  return offset >= region.start && (offset < region.end || !region.closed);
}

// --- small string / path utilities -----------------------------------------

function isWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function isAsciiLetter(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }

  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z")
  );
}

function isPotentialLatteExpressionOpening(
  source: string,
  openBrace: number,
): boolean {
  const next = source[openBrace + 1];

  return (
    isAsciiLetter(next) ||
    next === "$" ||
    next === "=" ||
    next === "/" ||
    next === "_"
  );
}

function trimRange(source: string, start: number, end: number): TokenRegion {
  let rangeStart = Math.max(0, start);
  let rangeEnd = Math.max(rangeStart, Math.min(end, source.length));

  while (rangeStart < rangeEnd && isWhitespace(source[rangeStart])) {
    rangeStart += 1;
  }

  while (rangeEnd > rangeStart && isWhitespace(source[rangeEnd - 1])) {
    rangeEnd -= 1;
  }

  return { end: rangeEnd, start: rangeStart };
}

function skipWhitespace(source: string, from: number, limit: number): number {
  let index = from;

  while (index < limit && isWhitespace(source[index])) {
    index += 1;
  }

  return index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function lcfirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
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
