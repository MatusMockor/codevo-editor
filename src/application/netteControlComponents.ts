import {
  detectLatteControlAt,
  detectLatteFormFieldMacroAt,
  detectLatteFormFieldMacroCompletionAt,
  detectLatteFormMacroAt,
  detectLatteFormNameAt,
  detectLatteFormNameCompletionAt,
  detectNetteCreateComponentAt,
  latteActiveFormComponentAt,
  netteComponentUsagesInLatte,
  netteCreateComponentFactoryContexts,
  netteCreateComponentMethodName,
  netteFormFieldDefinitionsInCreateComponent,
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
import { loadNettePresenterComponentNames } from "./netteControlComponentNames";
import { phpMethodPositionInSource } from "./phpMethodPosition";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type {
  NetteControlCompletionContext,
  NetteControlCompletionItem,
  NetteControlDependencies,
} from "./netteControlContracts";

export type {
  NetteControlCache,
  NetteControlCacheEntry,
  NetteControlCompletionContext,
  NetteControlCompletionItem,
  NetteControlDependencies,
} from "./netteControlContracts";

interface LatteControlCompletion {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

interface NetteControlReference {
  fieldName?: string;
  name: string;
  part?: string;
}

const FORM_FIELD_TAGS: ReadonlySet<string> = new Set([
  "button",
  "input",
  "select",
  "textarea",
]);

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

  const formMacro = detectLatteFormMacroAt(source, offset);

  if (formMacro) {
    return { name: formMacro.name };
  }

  const fieldMacro = detectLatteFormFieldMacroAt(source, offset);

  if (fieldMacro) {
    return { fieldName: fieldMacro.name, name: fieldMacro.formName };
  }

  const formName = detectLatteFormNameAt(source, offset);

  if (formName && formName.elementTag === "form") {
    return { name: formName.name };
  }

  if (formName && isFormFieldTag(formName.elementTag)) {
    const activeForm = latteActiveFormComponentAt(source, offset);

    if (activeForm) {
      return { fieldName: formName.name, name: activeForm.name };
    }
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

  const { fieldName, name: componentName, part } = reference;
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

    if (fieldName) {
      const field = netteFormFieldDefinitionsInCreateComponent(
        content,
        componentName,
      ).find((definition) => definition.name === fieldName);

      if (!field) {
        continue;
      }

      return deps.openTarget(
        path,
        editorPositionAtOffset(content, field.nameStart),
        fieldName,
      );
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

  if (
    !span ||
    (span.tagName !== "control" && span.tagName !== "form") ||
    offset < span.expressionStart
  ) {
    return null;
  }

  const typed = source.slice(span.expressionStart, offset);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$|^$/.test(typed)) {
    return null;
  }

  return { prefix: typed, replaceEnd: offset, replaceStart: span.expressionStart };
}

export function latteFormFieldMacroCompletionAt(
  source: string,
  offset: number,
): LatteControlCompletion | null {
  const completion = detectLatteFormFieldMacroCompletionAt(source, offset);

  if (!completion) {
    return null;
  }

  return {
    prefix: completion.prefix,
    replaceEnd: completion.replaceEnd,
    replaceStart: completion.replaceStart,
  };
}

export async function latteFormFieldMacroCompletions(
  context: NetteControlCompletionContext,
  source: string,
  offset: number,
  completion: LatteControlCompletion,
): Promise<NetteControlCompletionItem[]> {
  const detected = detectLatteFormFieldMacroCompletionAt(source, offset);

  if (!detected) {
    return [];
  }

  return latteFormFieldCompletions(context, detected.formName, completion);
}

export function latteFormNameCompletionAt(
  source: string,
  offset: number,
): LatteControlCompletion | null {
  const completion = detectLatteFormNameCompletionAt(source, offset);

  if (!completion) {
    return null;
  }

  if (
    completion.elementTag !== "form" &&
    !isFormFieldTag(completion.elementTag)
  ) {
    return null;
  }

  return {
    prefix: completion.prefix,
    replaceEnd: completion.replaceEnd,
    replaceStart: completion.replaceStart,
  };
}

export async function latteFormNameCompletions(
  context: NetteControlCompletionContext,
  source: string,
  offset: number,
  completion: LatteControlCompletion,
): Promise<NetteControlCompletionItem[]> {
  const detected = detectLatteFormNameCompletionAt(source, offset);

  if (!detected) {
    return [];
  }

  if (detected.elementTag === "form") {
    return latteControlCompletions(context, completion);
  }

  if (!isFormFieldTag(detected.elementTag)) {
    return [];
  }

  const activeForm = latteActiveFormComponentAt(source, offset);

  if (!activeForm) {
    return [];
  }

  return latteFormFieldCompletions(context, activeForm.name, completion);
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

async function latteFormFieldCompletions(
  context: NetteControlCompletionContext,
  componentName: string,
  completion: LatteControlCompletion,
): Promise<NetteControlCompletionItem[]> {
  const fields = await loadNetteFormFieldDefinitions(context, componentName);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return fields
    .filter((field) => field.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, context.maxCompletions)
    .map((field) => ({
      detail: "Nette form field",
      insertText: field.name,
      kind: "component" as const,
      label: field.name,
      replaceEnd: completion.replaceEnd,
      replaceStart: completion.replaceStart,
    }));
}

async function loadNetteFormFieldDefinitions(
  context: NetteControlCompletionContext,
  componentName: string,
): Promise<ReturnType<typeof netteFormFieldDefinitionsInCreateComponent>> {
  const {
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
  } = context;

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

    const fields = netteFormFieldDefinitionsInCreateComponent(content, componentName);

    if (fields.length > 0) {
      return fields;
    }

    if (netteCreateComponentFactoryExists(content, componentName)) {
      return [];
    }
  }

  return [];
}

function netteCreateComponentFactoryExists(
  source: string,
  componentName: string,
): boolean {
  return netteCreateComponentFactoryContexts(source).some(
    (context) => context.componentName === componentName,
  );
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

function isFormFieldTag(elementTag: string | null): boolean {
  return elementTag !== null && FORM_FIELD_TAGS.has(elementTag);
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
