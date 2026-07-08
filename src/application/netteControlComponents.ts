import {
  detectLatteControlAt,
  detectLatteFormNameAt,
  detectLatteFormNameCompletionAt,
  detectNetteCreateComponentAt,
  netteComponentUsagesInLatte,
  netteCreateComponentFactoryContexts,
  netteCreateComponentMethodName,
  nettePresenterLifecycleInfo,
} from "../domain/netteComponents";
import { innermostLatteExpressionSpanAt } from "../domain/latteSyntax";
import {
  componentTemplateCandidatePathsForClass,
  presenterTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import {
  componentOwnerCandidatePathsForTemplate,
} from "./netteTemplateOwnerCandidates";
import { phpMethodPositionInSource } from "./phpMethodPosition";
import type { EditorPosition } from "../domain/languageServerFeatures";

export interface NetteControlDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  openPhpMethodTarget(className: string, methodName: string): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
}

export interface NetteControlCompletionItem {
  detail?: string;
  insertText: string;
  kind: "component";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export interface NetteControlCacheEntry {
  componentNames: string[];
  expiresAt: number;
  templateRelativePath: string;
}

export type NetteControlCache = Record<string, NetteControlCacheEntry>;

export interface NetteControlCompletionContext {
  componentCache: NetteControlCache;
  deps: NetteControlDependencies;
  isRequestedRootActive(): boolean;
  maxCompletions: number;
  requestedRoot: string;
  templateRelativePath: string;
  ttlMs: number;
}

interface LatteControlCompletion {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

interface NetteControlReference {
  name: string;
  part?: string;
}

export function netteControlReferenceAt(
  source: string,
  offset: number,
): NetteControlReference | null {
  const control = detectLatteControlAt(source, offset);

  if (control) {
    return control.part
      ? { name: control.name, part: control.part }
      : { name: control.name };
  }

  const formName = detectLatteFormNameAt(source, offset);

  if (formName && formName.elementTag === "form") {
    return { name: formName.name };
  }

  return null;
}

export async function resolveNetteControlDefinition(
  deps: NetteControlDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  reference: NetteControlReference | null,
  currentRelativePath: string,
): Promise<boolean> {
  if (!reference) {
    return false;
  }

  const { name: componentName, part } = reference;
  const methodName = netteCreateComponentMethodName(componentName);
  const candidatePaths = componentOwnerCandidatePathsForTemplate(
    currentRelativePath,
  );

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const position = phpMethodPositionInSource(content, [methodName]);

    if (!position) {
      continue;
    }

    if (part) {
      const partHandled = await resolveNetteControlRenderPartDefinition(
        deps,
        content,
        componentName,
        part,
      );

      if (partHandled) {
        return true;
      }
    }

    return deps.openTarget(path, position, componentName);
  }

  return false;
}

export function latteControlCompletionAt(
  source: string,
  offset: number,
): LatteControlCompletion | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span || span.tagName !== "control" || offset < span.expressionStart) {
    return null;
  }

  const typed = source.slice(span.expressionStart, offset);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$|^$/.test(typed)) {
    return null;
  }

  return { prefix: typed, replaceEnd: offset, replaceStart: span.expressionStart };
}

export function latteFormNameCompletionAt(
  source: string,
  offset: number,
): LatteControlCompletion | null {
  const completion = detectLatteFormNameCompletionAt(source, offset);

  if (!completion || completion.elementTag !== "form") {
    return null;
  }

  return {
    prefix: completion.prefix,
    replaceEnd: completion.replaceEnd,
    replaceStart: completion.replaceStart,
  };
}

export async function latteControlCompletions(
  context: NetteControlCompletionContext,
  completion: LatteControlCompletion,
): Promise<NetteControlCompletionItem[]> {
  const names = await loadNettePresenterComponentNames(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, context.maxCompletions)
    .map((name) => ({
      detail: "Nette component",
      insertText: name,
      kind: "component" as const,
      label: name,
      replaceEnd: completion.replaceEnd,
      replaceStart: completion.replaceStart,
    }));
}

export async function resolveNetteCreateComponentReverse(
  deps: NetteControlDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  detection: ReturnType<typeof detectNetteCreateComponentAt>,
  presenterSource: string,
  presenterRelativePath: string,
): Promise<boolean> {
  if (!detection || presenterRelativePath.length === 0) {
    return false;
  }

  for (const relativePath of presenterTemplateCandidatesForViews(
    presenterRelativePath,
    presenterViewNames(presenterSource),
  )) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const usages = netteComponentUsagesInLatte(content, detection.componentName);
    const firstUsage = usages[0];

    if (!firstUsage) {
      continue;
    }

    return deps.openTarget(
      path,
      editorPositionAtOffset(content, firstUsage.start),
      detection.componentName,
    );
  }

  return false;
}

async function loadNettePresenterComponentNames(
  context: NetteControlCompletionContext,
): Promise<string[]> {
  const {
    componentCache,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
    ttlMs,
  } = context;
  const cached = componentCache[requestedRoot];

  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.templateRelativePath === templateRelativePath
  ) {
    return cached.componentNames;
  }

  const componentNames = await scanNettePresenterComponentNames(
    deps,
    requestedRoot,
    isRequestedRootActive,
    templateRelativePath,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  componentCache[requestedRoot] = {
    componentNames,
    expiresAt: Date.now() + ttlMs,
    templateRelativePath,
  };

  return componentNames;
}

async function scanNettePresenterComponentNames(
  deps: NetteControlDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  templateRelativePath: string,
): Promise<string[]> {
  for (const relativePath of componentOwnerCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return [];
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    return netteComponentNamesFromPresenter(content);
  }

  return [];
}

function resolveNetteControlRenderPartDefinition(
  deps: NetteControlDependencies,
  presenterSource: string,
  componentName: string,
  part: string,
): Promise<boolean> {
  const renderMethod = netteControlRenderMethodName(part);

  if (!renderMethod) {
    return Promise.resolve(false);
  }

  return resolveControlFactoryRenderMethod(
    deps,
    presenterSource,
    componentName,
    renderMethod,
  );
}

async function resolveControlFactoryRenderMethod(
  deps: NetteControlDependencies,
  presenterSource: string,
  componentName: string,
  renderMethod: string,
): Promise<boolean> {
  for (const factory of netteCreateComponentFactoryContexts(presenterSource)) {
    if (factory.componentName !== componentName || !factory.controlClass) {
      continue;
    }

    const controlClass =
      deps.resolveDeclaredType(presenterSource, factory.controlClass) ??
      factory.controlClass;

    if (await deps.openPhpMethodTarget(controlClass, renderMethod)) {
      return true;
    }
  }

  return false;
}

function netteControlRenderMethodName(part: string): string | null {
  const normalized = part
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    return null;
  }

  return `render${normalized}`;
}

function netteComponentNamesFromPresenter(source: string): string[] {
  const names: string[] = [];

  for (const entry of nettePresenterLifecycleInfo(source).lifecycle) {
    if (entry.kind === "createComponent" && entry.name) {
      names.push(entry.name);
    }
  }

  return Array.from(new Set(names)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function presenterViewNames(presenterSource: string): string[] {
  const views = new Set<string>(["default"]);

  for (const entry of nettePresenterLifecycleInfo(presenterSource).lifecycle) {
    if ((entry.kind === "render" || entry.kind === "action") && entry.name) {
      views.add(entry.name);
    }
  }

  return Array.from(views);
}

function presenterTemplateCandidatesForViews(
  presenterRelativePath: string,
  views: readonly string[],
): string[] {
  const componentTemplates =
    componentTemplateCandidatePathsForClass(presenterRelativePath);

  if (componentTemplates.length > 0) {
    return componentTemplates;
  }

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const view of views) {
    for (const candidate of presenterTemplateCandidatePaths(
      presenterRelativePath,
      view,
    )) {
      if (seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      paths.push(candidate);
    }
  }

  return paths;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}
