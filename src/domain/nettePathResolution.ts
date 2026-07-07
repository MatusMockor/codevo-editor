/**
 * Pure resolution of Nette Latte template / presenter relationships to candidate
 * TARGET PATHS, relative to the workspace root.
 *
 * This module answers path-mapping questions for the Nette framework profile:
 *
 *   - Where does an `{include 'file.latte'}` / `{layout '...'}` reference point,
 *     resolved against the current template's directory? — `resolveLatteTemplateCandidatePaths`.
 *   - Which template file(s) render a presenter action, across BOTH Nette
 *     project conventions? — `presenterTemplateCandidatePaths`.
 *   - Where does the `@layout.latte` auto-lookup search? — `latteLayoutCandidatePaths`.
 *   - Which presenter renders a given template (the inverse)? —
 *     `presenterCandidatePathsForTemplate`.
 *
 * It mirrors `laravelPathResolution.ts`: deliberately FILESYSTEM-FREE — it only
 * constructs ordered candidate relative paths from string logic. Verifying which
 * candidate actually exists is the responsibility of the navigation / completion
 * integration layer. It stays CONSERVATIVE and DETERMINISTIC: any input that is
 * blank, namespaced, path-traversing above the root, or otherwise malformed
 * resolves to `[]` rather than a guessed path.
 *
 * Two Nette structures are supported (spec §4.5), both emitted so the integration
 * layer can pick whichever exists:
 *   1. Classic: `app/Presenters/ProductPresenter.php` +
 *      `app/Presenters/templates/Product/show.latte` (or the dotted
 *      `templates/Product.show.latte`), layout `templates/@layout.latte`.
 *   2. Modern (nette/web-project 3.2+): `app/UI/Product/ProductPresenter.php` +
 *      `app/UI/Product/show.latte` (template beside the presenter), layout
 *      `app/UI/@layout.latte` walked up to the app root.
 */

const PRESENTER_SUFFIX = "Presenter.php";
const LATTE_EXTENSION = ".latte";
const DEFAULT_VIEW = "default";
const LAYOUT_BASENAME = "@layout";

/** Upper bound on layout auto-lookup depth (hang-safety on pathological paths). */
const MAX_LAYOUT_DEPTH = 128;

/**
 * Resolves an `{include '...'}` / `{layout '...'}` file reference to candidate
 * workspace-relative paths, resolved against the current template's directory
 * (Nette includes are relative to the including template's location).
 *
 * A leading `/` is treated as workspace-root relative. `.`/`..` segments are
 * collapsed; a reference that escapes above the workspace root resolves to `[]`.
 * A reference with no file extension gets `.latte` appended.
 */
export function resolveLatteTemplateCandidatePaths(
  reference: string,
  currentTemplateRelativePath: string,
): string[] {
  const ref = normalizeSlashes(reference).trim();

  if (ref.length === 0 || ref.includes("::")) {
    return [];
  }

  const base = rootRelative(ref)
    ? ""
    : dirnameOf(normalizeSlashes(currentTemplateRelativePath).trim());
  const body = rootRelative(ref) ? ref.replace(/^\/+/, "") : ref;
  const combined = base.length > 0 ? `${base}/${body}` : body;
  const segments = collapseRelative(combined);

  if (!segments) {
    return [];
  }

  const candidates = [lattePathWithExtension(segments)];
  const moduleTemplatesRootSegments = moduleTemplatesRootRelativeSegments(
    ref,
    currentTemplateRelativePath,
  );

  if (moduleTemplatesRootSegments) {
    candidates.push(lattePathWithExtension(moduleTemplatesRootSegments));
  }

  return dedupe(candidates);
}

/**
 * Maps a presenter action / render method name to its Latte view name.
 * `renderShow` → `show`, `actionDefault` → `default`; a bare `show` is used
 * verbatim; a blank name falls back to the Nette default view (`default`).
 *
 * A `render`/`action` prefix is only stripped when it is immediately followed by
 * an uppercase letter (so `renderer` stays `renderer`, not `er`).
 */
export function latteViewNameFromAction(action: string): string {
  const trimmed = action.trim();

  if (trimmed.length === 0) {
    return DEFAULT_VIEW;
  }

  const match = /^(?:render|action)([A-Z][A-Za-z0-9_]*)$/.exec(trimmed);

  if (!match) {
    return trimmed;
  }

  const rest = match[1] ?? "";

  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/**
 * Maps a presenter class file path and an action/render method (or bare view)
 * name to candidate template paths covering BOTH Nette conventions, in
 * deterministic order: modern sibling first, then the classic `templates/`
 * subfolder and dotted forms.
 *
 * Conservative: a file whose name does not end with `Presenter.php`, or an
 * unusable view name, resolves to `[]`.
 */
export function presenterTemplateCandidatePaths(
  presenterRelativePath: string,
  action: string,
): string[] {
  const path = normalizeSlashes(presenterRelativePath).trim();

  if (!path.endsWith(PRESENTER_SUFFIX)) {
    return [];
  }

  const presenterDir = dirnameOf(path);
  const fileName = basenameOf(path);
  const short = fileName.slice(0, -PRESENTER_SUFFIX.length);

  if (!isUsableIdentifier(short)) {
    return [];
  }

  const view = latteViewNameFromAction(action);

  if (!isUsableSegment(view)) {
    return [];
  }

  const modern = joinRelative(presenterDir, `${view}${LATTE_EXTENSION}`);
  const classicSubfolder = joinRelative(
    presenterDir,
    `templates/${short}/${view}${LATTE_EXTENSION}`,
  );
  const classicDotted = joinRelative(
    presenterDir,
    `templates/${short}.${view}${LATTE_EXTENSION}`,
  );

  return dedupe([modern, classicSubfolder, classicDotted]);
}

/**
 * Produces the `@layout.latte` auto-lookup candidates for a template: the layout
 * file in the template's own directory, then in each parent directory up to (and
 * including) the workspace root, nearest first.
 */
export function latteLayoutCandidatePaths(
  currentTemplateRelativePath: string,
): string[] {
  const path = normalizeSlashes(currentTemplateRelativePath).trim();

  if (path.length === 0) {
    return [];
  }

  const layoutFile = `${LAYOUT_BASENAME}${LATTE_EXTENSION}`;
  const candidates: string[] = [];
  let dir = dirnameOf(path);
  let depth = 0;

  while (depth < MAX_LAYOUT_DEPTH) {
    depth += 1;
    candidates.push(joinRelative(dir, layoutFile));

    if (dir.length === 0) {
      break;
    }

    dir = parentDirOf(dir);
  }

  return dedupe(candidates);
}

/**
 * Inverse of `presenterTemplateCandidatePaths`: maps a Latte template path back
 * to candidate presenter class paths, covering the modern sibling convention and
 * the classic `templates/` subfolder + dotted conventions.
 *
 * Conservative: a non-`.latte` file, or a template whose location matches no
 * known convention, resolves to `[]`.
 */
export function presenterCandidatePathsForTemplate(
  templateRelativePath: string,
): string[] {
  const path = normalizeSlashes(templateRelativePath).trim();

  if (path.length === 0 || !path.endsWith(LATTE_EXTENSION)) {
    return [];
  }

  const dir = dirnameOf(path);
  const fileName = basenameOf(path);

  return dedupe([
    ...classicDescendantPresenterCandidate(dir),
    ...classicSubfolderPresenterCandidate(dir),
    ...classicDottedPresenterCandidate(dir, fileName),
    ...modernPresenterCandidate(dir),
  ]);
}

/**
 * Maps a component/control template back to its colocated PHP class.
 *
 * Nette projects commonly keep component templates next to their backing class:
 * `Components/ApiConsoleControl/api_console.latte` is rendered by
 * `Components/ApiConsoleControl/ApiConsoleControl.php`. Some projects put the
 * same files under a nested `templates/` directory; that remains colocated with
 * the parent component directory. This is intentionally a conservative
 * colocated-only strategy; parent presenters and service factories are still
 * resolved by the integration layer's existing presenter candidates.
 */
export function componentClassCandidatePathsForTemplate(
  templateRelativePath: string,
): string[] {
  const path = normalizeSlashes(templateRelativePath).trim();

  if (path.length === 0 || !path.endsWith(LATTE_EXTENSION)) {
    return [];
  }

  return componentClassCandidate(dirnameOf(path), basenameOf(path));
}

/**
 * Maps a component/control PHP class back to likely colocated Latte templates.
 * The stripped-name candidates cover `ApiConsoleControl -> api_console.latte`,
 * while the full-name candidates cover widget-style templates such as
 * `UserTimeTravelWidget -> user_time_travel_widget.latte`.
 */
export function componentTemplateCandidatePathsForClass(
  componentRelativePath: string,
): string[] {
  const path = normalizeSlashes(componentRelativePath).trim();

  if (path.length === 0 || !path.endsWith(".php")) {
    return [];
  }

  const dir = dirnameOf(path);

  if (!hasComponentsSegment(dir)) {
    return [];
  }

  const shortName = basenameOf(path).slice(0, -".php".length);

  if (!isUsableIdentifier(shortName)) {
    return [];
  }

  return dedupe(
    componentTemplateBasenames(shortName).map((basename) =>
      joinRelative(dir, `${basename}${LATTE_EXTENSION}`),
    ),
  );
}

/**
 * Modern convention: presenter sits beside the template, named after its
 * directory. `templates` is the classic-convention marker segment, never a
 * real component name, so it is skipped here - `.../templates/Product.show.latte`
 * must not yield a dead `TemplatesPresenter.php` candidate.
 */
function modernPresenterCandidate(dir: string): string[] {
  const dirName = basenameOf(dir);

  if (dirName === "templates" || !isUsableIdentifier(dirName)) {
    return [];
  }

  return [joinRelative(dir, `${ucfirst(dirName)}${PRESENTER_SUFFIX}`)];
}

function componentClassCandidate(dir: string, fileName: string): string[] {
  const candidateDir =
    basenameOf(dir) === "templates" ? parentDirOf(dir) : dir;

  if (!hasComponentsSegment(candidateDir)) {
    return [];
  }

  const dirName = basenameOf(candidateDir);

  if (!isUsableIdentifier(dirName)) {
    return [];
  }

  const candidates: string[] = [];
  const templateBase = fileName.slice(0, -LATTE_EXTENSION.length);
  const dirShortName = ucfirst(dirName);
  const strippedDirName = strippedComponentClassName(dirShortName);
  const templateMatchesDir =
    templateBase === "default" ||
    camelToSnake(dirShortName) === templateBase ||
    Boolean(strippedDirName && camelToSnake(strippedDirName) === templateBase);

  if (templateMatchesDir) {
    candidates.push(...componentClassBasenamesFromStem(dirShortName));
  }

  if (
    !templateMatchesDir &&
    templateBase !== "default" &&
    isSnakeIdentifier(templateBase)
  ) {
    candidates.push(
      ...componentClassBasenamesFromStem(snakeToPascal(templateBase)),
    );
  }

  candidates.push(...componentClassBasenamesFromStem(dirShortName));

  return dedupe(
    candidates
      .filter(isUsableIdentifier)
      .map((candidate) => joinRelative(candidateDir, `${candidate}.php`)),
  );
}

function hasComponentsSegment(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment.toLowerCase() === "components");
}

/** Classic convention: `.../templates/<Short>/<view>.latte`. */
function classicSubfolderPresenterCandidate(dir: string): string[] {
  const match = /^(.*)\/templates\/([^/]+)$/.exec(dir);

  if (!match) {
    return [];
  }

  const presenterBase = match[1] ?? "";
  const short = match[2] ?? "";

  if (!isUsableIdentifier(short)) {
    return [];
  }

  return classicPresenterCandidatesFromBase(presenterBase, short);
}

/** Classic convention partials: `.../templates/<Short>/partials/file.latte`. */
function classicDescendantPresenterCandidate(dir: string): string[] {
  const match = /^(.*)\/templates\/([^/]+)\/.+$/.exec(dir);

  if (!match) {
    return [];
  }

  const presenterBase = match[1] ?? "";
  const short = match[2] ?? "";

  if (!isUsableIdentifier(short)) {
    return [];
  }

  return classicPresenterCandidatesFromBase(presenterBase, short);
}

function classicPresenterCandidatesFromBase(
  presenterBase: string,
  short: string,
): string[] {
  const file = `${ucfirst(short)}${PRESENTER_SUFFIX}`;

  if (basenameOf(presenterBase).toLowerCase() === "presenters") {
    return [joinRelative(presenterBase, file)];
  }

  return [
    joinRelative(presenterBase, `Presenters/${file}`),
    joinRelative(presenterBase, `presenters/${file}`),
    joinRelative(presenterBase, file),
  ];
}

/** Classic dotted convention: `.../templates/<Short>.<view>.latte`. */
function classicDottedPresenterCandidate(
  dir: string,
  fileName: string,
): string[] {
  const isTemplatesDir = dir === "templates" || dir.endsWith("/templates");

  if (!isTemplatesDir) {
    return [];
  }

  const base = fileName.slice(0, -LATTE_EXTENSION.length);
  const short = base.split(".")[0] ?? "";

  if (base.indexOf(".") < 0 || !isUsableIdentifier(short)) {
    return [];
  }

  const presenterBase = parentDirOf(dir);

  return [joinRelative(presenterBase, `${ucfirst(short)}${PRESENTER_SUFFIX}`)];
}

function normalizeSlashes(path: string): string {
  return path.split("\\").join("/");
}

function rootRelative(reference: string): boolean {
  return reference.startsWith("/");
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return path.slice(0, index);
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return path;
  }

  return path.slice(index + 1);
}

function componentTemplateBasenames(shortName: string): string[] {
  const full = camelToSnake(shortName);
  const stripped = strippedComponentClassName(shortName);
  const fallback = "default";

  if (!stripped || stripped === shortName) {
    return [full, fallback];
  }

  const strippedName = camelToSnake(stripped);

  if (shortName.endsWith("Widget")) {
    return [full, strippedName, fallback];
  }

  return [strippedName, full, fallback];
}

function componentClassBasenamesFromStem(stem: string): string[] {
  if (hasComponentSuffix(stem)) {
    return [stem];
  }

  return [stem, `${stem}Control`, `${stem}Component`, `${stem}Widget`];
}

function hasComponentSuffix(name: string): boolean {
  return ["Control", "Component", "Widget"].some((suffix) =>
    name.endsWith(suffix),
  );
}

function strippedComponentClassName(shortName: string): string | null {
  for (const suffix of ["Control", "Component", "Widget"]) {
    if (shortName.endsWith(suffix) && shortName.length > suffix.length) {
      return shortName.slice(0, -suffix.length);
    }
  }

  return null;
}

function camelToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function snakeToPascal(name: string): string {
  return name
    .split("_")
    .filter((segment) => segment.length > 0)
    .map(ucfirst)
    .join("");
}

function parentDirOf(dir: string): string {
  const index = dir.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return dir.slice(0, index);
}

function lattePathWithExtension(segments: string[]): string {
  const path = segments.join("/");
  const lastSegment = segments[segments.length - 1] ?? "";

  if (lastSegment.includes(".")) {
    return path;
  }

  return `${path}${LATTE_EXTENSION}`;
}

/**
 * Some legacy modular Nette apps (including ebox-crm-style layouts) refer to
 * templates from the module's `templates/` root:
 * `templates/Current/default.latte` can include
 * `Other/partials/header.latte`. Keep normal Latte-relative resolution first,
 * then try this module-template-root form as a conservative fallback.
 */
function moduleTemplatesRootRelativeSegments(
  reference: string,
  currentTemplateRelativePath: string,
): string[] | null {
  if (rootRelative(reference)) {
    return null;
  }

  if (reference.startsWith(".") || reference.startsWith("../")) {
    return null;
  }

  const templatesRoot = moduleTemplatesRootOf(
    normalizeSlashes(currentTemplateRelativePath).trim(),
  );

  if (!templatesRoot) {
    return null;
  }

  return collapseRelative(`${templatesRoot}/${reference}`);
}

export function moduleTemplatesRootOf(path: string): string | null {
  const segments = normalizeSlashes(path)
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0);
  const templatesIndex = segments.lastIndexOf("templates");

  if (templatesIndex <= 0) {
    return null;
  }

  const ancestors = segments.slice(0, templatesIndex);
  const insideModule = ancestors.some((segment) => segment.endsWith("Module"));

  if (!insideModule) {
    return null;
  }

  return segments.slice(0, templatesIndex + 1).join("/");
}

function joinRelative(dir: string, tail: string): string {
  if (dir.length === 0) {
    return tail;
  }

  return `${dir}/${tail}`;
}

/**
 * Collapses `.`/`..`/empty segments. Returns `null` when the path escapes above
 * the workspace root or collapses to nothing.
 */
function collapseRelative(path: string): string[] | null {
  const result: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (result.length === 0) {
        return null;
      }

      result.pop();
      continue;
    }

    result.push(segment);
  }

  if (result.length === 0) {
    return null;
  }

  return result;
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

function ucfirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isUsableIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(value);
}

function isUsableSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isSnakeIdentifier(value: string): boolean {
  return /^[a-z0-9_]+$/.test(value);
}
