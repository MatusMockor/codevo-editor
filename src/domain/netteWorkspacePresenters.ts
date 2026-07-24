import { nettePresenterLifecycleInfo } from "./netteComponents";
import { presenterTemplateCandidatePaths } from "./nettePathResolution";
import { maskPhpSource } from "./phpSourceMask";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

const MAX_PRESENTERS = 2_000;
const MAX_ACTIONS_PER_PRESENTER = 256;
const MAX_SIGNALS_PER_PRESENTER = 256;
const MAX_TEMPLATES_PER_ACTION = 16;

export interface NetteWorkspacePresenterSourceEntry {
  readonly path: string;
  readonly source: string;
}

export interface NetteWorkspacePresenterOverlay {
  readonly path: string;
  readonly source: string;
}

export interface NetteWorkspacePresenterSource {
  readonly path: string;
  readonly lineNumber: number;
  readonly column: number;
}

export interface NetteWorkspaceTemplateSource {
  readonly path: string;
  readonly lineNumber: 1;
  readonly column: 1;
}

export interface NetteWorkspacePresenterMethod {
  readonly methodName: string;
  readonly source: NetteWorkspacePresenterSource;
}

export interface NetteWorkspacePresenterAction {
  readonly key: string;
  readonly name: string;
  readonly actionMethod: NetteWorkspacePresenterMethod | null;
  readonly renderMethod: NetteWorkspacePresenterMethod | null;
  readonly templates: readonly NetteWorkspaceTemplateSource[];
  readonly templatesTruncated: boolean;
}

export interface NetteWorkspacePresenterSignal {
  readonly key: string;
  readonly name: string;
  readonly method: NetteWorkspacePresenterMethod;
}

export interface NetteWorkspacePresenter {
  readonly key: string;
  readonly name: string;
  readonly className: string | null;
  readonly source: NetteWorkspacePresenterSource;
  readonly actions: readonly NetteWorkspacePresenterAction[];
  readonly actionsTruncated: boolean;
  readonly signals: readonly NetteWorkspacePresenterSignal[];
  readonly signalsTruncated: boolean;
}

export type NetteWorkspacePresentersResult =
  | {
      readonly status: "ok";
      readonly presenters: readonly NetteWorkspacePresenter[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export interface NetteWorkspacePresenterProjectionOptions {
  readonly maxPresenters?: number;
  readonly maxActionsPerPresenter?: number;
  readonly maxSignalsPerPresenter?: number;
  readonly maxTemplatesPerAction?: number;
}

interface MutableAction {
  readonly name: string;
  readonly firstOffset: number;
  actionMethod: NetteWorkspacePresenterMethod | null;
  renderMethod: NetteWorkspacePresenterMethod | null;
}

/** Pure, filesystem-free projection of sources found by existing bounded scans. */
export function projectNetteWorkspacePresenters(
  rootPath: string,
  sourceEntries: readonly NetteWorkspacePresenterSourceEntry[],
  templateRelativePaths: readonly string[],
  overlays: readonly NetteWorkspacePresenterOverlay[] = [],
  options: NetteWorkspacePresenterProjectionOptions = {},
): NetteWorkspacePresentersResult {
  if (!rootPath.trim()) {
    return { status: "unavailable", message: "No workspace is open." };
  }

  try {
    const sources = effectivePresenterSources(rootPath, sourceEntries, overlays);
    const templatePaths = validTemplatePaths(templateRelativePaths);
    const maxPresenters = boundedOption(options.maxPresenters, MAX_PRESENTERS);
    const presenters = sources
      .map((entry) => projectPresenter(rootPath, entry, templatePaths, options))
      .sort((left, right) => left.source.path.localeCompare(right.source.path));

    return {
      status: "ok",
      presenters: presenters.slice(0, maxPresenters),
      total: presenters.length,
      truncated: presenters.length > maxPresenters,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function projectPresenter(
  rootPath: string,
  entry: NetteWorkspacePresenterSourceEntry,
  templatePaths: ReadonlySet<string>,
  options: NetteWorkspacePresenterProjectionOptions,
): NetteWorkspacePresenter {
  const relativePath = safeWorkspaceRelativePath(rootPath, entry.path) as string;
  const lineStarts = computeLineStartOffsets(entry.source);
  const shortName = presenterShortName(relativePath);
  const classInfo = presenterClassInfo(entry.source, `${shortName}Presenter`);
  const source = sourceAt(entry.path, lineStarts, classInfo?.offset ?? 0);
  const actionByName = new Map<string, MutableAction>();
  const signals: NetteWorkspacePresenterSignal[] = [];

  for (const lifecycle of nettePresenterLifecycleInfo(entry.source).lifecycle) {
    if (!lifecycle.name) continue;
    const method = {
      methodName: lifecycle.methodName,
      source: sourceAt(entry.path, lineStarts, lifecycle.offset),
    };

    if (lifecycle.kind === "handle") {
      signals.push({
        key: stableKey(relativePath, "signal", lifecycle.name),
        name: lifecycle.name,
        method,
      });
      continue;
    }

    if (lifecycle.kind !== "action" && lifecycle.kind !== "render") continue;
    const current = actionByName.get(lifecycle.name) ?? {
      name: lifecycle.name,
      firstOffset: lifecycle.offset,
      actionMethod: null,
      renderMethod: null,
    };
    if (lifecycle.kind === "action" && current.actionMethod === null) {
      current.actionMethod = method;
    }
    if (lifecycle.kind === "render" && current.renderMethod === null) {
      current.renderMethod = method;
    }
    actionByName.set(lifecycle.name, current);
  }

  const maxTemplates = boundedOption(options.maxTemplatesPerAction, MAX_TEMPLATES_PER_ACTION);
  const allActions = Array.from(actionByName.values())
    .sort((left, right) => left.firstOffset - right.firstOffset)
    .map((action): NetteWorkspacePresenterAction => {
      const existingTemplates = presenterTemplateCandidatePaths(relativePath, action.name).filter(
        (path) => templatePaths.has(path),
      );
      return {
        key: stableKey(relativePath, "action", action.name),
        name: action.name,
        actionMethod: action.actionMethod,
        renderMethod: action.renderMethod,
        templates: existingTemplates
          .slice(0, maxTemplates)
          .map((path) => templateSource(rootPath, path)),
        templatesTruncated: existingTemplates.length > maxTemplates,
      };
    });
  const maxActions = boundedOption(options.maxActionsPerPresenter, MAX_ACTIONS_PER_PRESENTER);
  const maxSignals = boundedOption(options.maxSignalsPerPresenter, MAX_SIGNALS_PER_PRESENTER);

  return {
    key: stableKey(relativePath, "presenter", relativePath),
    name: shortName,
    className: classInfo?.className ?? null,
    source,
    actions: allActions.slice(0, maxActions),
    actionsTruncated: allActions.length > maxActions,
    signals: signals.slice(0, maxSignals),
    signalsTruncated: signals.length > maxSignals,
  };
}

function effectivePresenterSources(
  rootPath: string,
  entries: readonly NetteWorkspacePresenterSourceEntry[],
  overlays: readonly NetteWorkspacePresenterOverlay[],
): NetteWorkspacePresenterSourceEntry[] {
  const overlaysByRelativePath = new Map<string, string>();
  for (const overlay of overlays) {
    const relativePath = safeWorkspaceRelativePath(rootPath, overlay.path);
    if (relativePath !== null) overlaysByRelativePath.set(relativePath, overlay.source);
  }

  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const relativePath = safeWorkspaceRelativePath(rootPath, entry.path);
    const shortName = relativePath === null ? "" : presenterShortName(relativePath);
    if (
      relativePath === null ||
      !relativePath.endsWith("Presenter.php") ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(shortName) ||
      seen.has(relativePath)
    ) {
      return [];
    }
    seen.add(relativePath);
    return [
      {
        path: entry.path,
        source: overlaysByRelativePath.get(relativePath) ?? entry.source,
      },
    ];
  });
}

function presenterClassInfo(
  source: string,
  expectedClassName: string,
): { readonly className: string; readonly offset: number } | null {
  const masked = maskPhpSource(source);
  const classMatch = new RegExp(`\\bclass\\s+(${expectedClassName})\\b`).exec(masked);
  if (!classMatch?.[1]) return null;
  const namespace = /\bnamespace\s+([^;{]+)[;{]/.exec(masked)?.[1]?.trim().replace(/^\\+/, "");
  return {
    className: namespace ? `${namespace}\\${classMatch[1]}` : classMatch[1],
    offset: classMatch.index + classMatch[0].lastIndexOf(classMatch[1]),
  };
}

function validTemplatePaths(paths: readonly string[]): ReadonlySet<string> {
  return new Set(
    paths
      .filter((path) => {
        const normalized = path.split("\\").join("/");
        return normalized.endsWith(".latte") && safeRelativePath(normalized);
      })
      .map((path) => path.split("\\").join("/")),
  );
}

function safeWorkspaceRelativePath(rootPath: string, path: string): string | null {
  const relativePath = workspaceRelativePath(rootPath, path);
  return relativePath !== null && safeRelativePath(relativePath) ? relativePath : null;
}

function safeRelativePath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function presenterShortName(relativePath: string): string {
  const fileName = relativePath.split("/").pop() ?? relativePath;
  return fileName.slice(0, -"Presenter.php".length);
}

function sourceAt(
  path: string,
  lineStarts: number[],
  offset: number,
): NetteWorkspacePresenterSource {
  return { path, ...lineColumnAt(lineStarts, offset) };
}

function templateSource(rootPath: string, relativePath: string): NetteWorkspaceTemplateSource {
  return { path: joinWorkspacePath(rootPath, relativePath), lineNumber: 1, column: 1 };
}

function stableKey(path: string, kind: string, name: string): string {
  return `nette-${kind}:${encodeURIComponent(path)}:${encodeURIComponent(name)}`;
}

function boundedOption(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}
