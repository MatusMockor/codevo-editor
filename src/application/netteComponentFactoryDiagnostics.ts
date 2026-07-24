import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { canProveNoUnresolvedNetteAddComponentCalls } from "../domain/netteComponentRegistrationProof";
import {
  netteAddComponentRegistrations,
  netteCreateComponentMethodName,
} from "../domain/netteComponents";
import {
  netteStaticComponentFactoryReferences,
  type NetteStaticComponentFactoryReference,
} from "../domain/netteStaticComponentFactoryReferences";
import { componentClassCandidatePathsForTemplate } from "../domain/nettePathResolution";
import { canProveNettePresenterMethodAbsenceLocally } from "../domain/nettePresenterMethodAbsence";
import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
} from "../domain/phpClassStructure";
import { computeLineStartOffsets, lineColumnAt } from "../domain/sourceLineOffsets";
import {
  canProveNetteFactoryTemplateOwnerMethodAbsence,
  findNetteFactoryTemplateOwnerMethodSource,
  type NetteFactoryTemplateOwnerHierarchy,
} from "./netteFactoryTemplateOwnerHierarchy";
import type { NettePresenterLinkDiagnosticContext } from "./nettePresenterLinkDiagnostics";
import { loadNettePresenterFactoryOwnerHierarchy } from "./nettePresenterResolution";

export interface NetteComponentFactoryDiagnosticData {
  componentName: string;
  kind: "missing-component-factory";
  methodName: string;
  ownerPath: string;
  target: string;
  usageKind: "control" | "form";
}

interface ComponentOwner {
  className: string;
  path: string;
  source: string;
}

const MAX_SOURCE_CHARACTERS = 750_000;
const MAX_REFERENCES = 256;
const MAX_OWNER_CANDIDATES = 24;
const GENERIC_FACTORY_METHOD = "createComponent";

export async function netteComponentFactoryDiagnostics(
  context: NettePresenterLinkDiagnosticContext,
  source: string,
): Promise<LanguageServerDiagnostic[]> {
  if (source.length > MAX_SOURCE_CHARACTERS || !isResolutionCurrent(context)) {
    return [];
  }

  const projection = netteStaticComponentFactoryReferences(source, MAX_REFERENCES);

  if (!projection.complete) {
    return [];
  }

  const diagnostics: LanguageServerDiagnostic[] = [];
  const ownerByName = new Map<string, Promise<ComponentOwner | null>>();
  const lineStarts = computeLineStartOffsets(source);

  for (const reference of projection.references) {
    if (!isResolutionCurrent(context)) {
      return [];
    }

    let ownerPromise = ownerByName.get(reference.name);

    if (!ownerPromise) {
      ownerPromise = resolveMissingComponentOwner(context, reference.name);
      ownerByName.set(reference.name, ownerPromise);
    }

    const owner = await ownerPromise;

    if (!isResolutionCurrent(context)) {
      return [];
    }

    if (owner) {
      diagnostics.push(missingFactoryDiagnostic(lineStarts, reference, owner));
    }
  }

  return diagnostics;
}

async function resolveMissingComponentOwner(
  context: NettePresenterLinkDiagnosticContext,
  componentName: string,
): Promise<ComponentOwner | null> {
  const methodName = netteCreateComponentMethodName(componentName);
  const factoryHierarchy = await loadNettePresenterFactoryOwnerHierarchy(context);

  if (!isResolutionCurrent(context)) {
    return null;
  }

  if (factoryHierarchy) {
    if (!(await factoryHierarchyIsFresh(context, factoryHierarchy))) {
      return null;
    }

    return missingFactoryHierarchyOwner(factoryHierarchy, componentName, methodName);
  }

  return resolveConventionalOwner(context, componentName, methodName);
}

function missingFactoryHierarchyOwner(
  hierarchy: NetteFactoryTemplateOwnerHierarchy,
  componentName: string,
  methodName: string,
): ComponentOwner | null {
  if (
    findNetteFactoryTemplateOwnerMethodSource(hierarchy, methodName) ||
    findNetteFactoryTemplateOwnerMethodSource(hierarchy, GENERIC_FACTORY_METHOD) ||
    hierarchy.sources.some((entry) =>
      netteAddComponentRegistrations(entry.source).some(
        (registration) => registration.name === componentName,
      ),
    ) ||
    hierarchy.sources.some((entry) => !canProveNoUnresolvedNetteAddComponentCalls(entry.source)) ||
    !canProveNetteFactoryTemplateOwnerMethodAbsence(hierarchy, [methodName, GENERIC_FACTORY_METHOD])
  ) {
    return null;
  }

  const className = shortClassName(hierarchy.owner.className);

  return exactOwner(hierarchy.owner.path, hierarchy.owner.source, className);
}

async function resolveConventionalOwner(
  context: NettePresenterLinkDiagnosticContext,
  componentName: string,
  methodName: string,
): Promise<ComponentOwner | null> {
  const target = {
    absolute: false,
    action: "default",
    isSignal: false,
    module: null,
    presenter: null,
  };
  const relativeCandidates = [
    ...componentClassCandidatePathsForTemplate(context.currentRelativePath),
    ...context.frameworkCapabilities.presenterClassCandidatePathsForLink(
      target,
      context.currentRelativePath,
    ),
  ].filter((path, index, paths) => paths.indexOf(path) === index);

  if (relativeCandidates.length === 0 || relativeCandidates.length > MAX_OWNER_CANDIDATES) {
    return null;
  }

  const readable: ComponentOwner[] = [];

  for (const relativePath of relativeCandidates) {
    if (!isResolutionCurrent(context)) {
      return null;
    }

    const path = context.deps.joinPath(context.requestedRoot, relativePath);
    let source: string;

    try {
      source = await context.deps.readFileContent(path);
    } catch {
      continue;
    }

    if (!isResolutionCurrent(context)) {
      return null;
    }

    const className = phpClassNameFromPath(path);
    const owner = className ? exactOwner(path, source, className) : null;

    if (owner) {
      readable.push(owner);
    }
  }

  if (readable.length !== 1) {
    return null;
  }

  const owner = readable[0];
  const structure = parsePhpClassStructure(owner.source, owner.className);

  if (
    !structure.typeDeclaration ||
    !hasDirectNetteUiParent(
      owner.source,
      owner.className,
      structure.typeDeclaration.bodyStartOffset,
    ) ||
    !canProveNettePresenterMethodAbsenceLocally(owner.source, structure.typeDeclaration) ||
    structure.methods.some(
      (method) =>
        method.name.toLowerCase() === methodName.toLowerCase() ||
        method.name.toLowerCase() === GENERIC_FACTORY_METHOD.toLowerCase(),
    ) ||
    netteAddComponentRegistrations(owner.source).some(
      (registration) => registration.name === componentName,
    ) ||
    !canProveNoUnresolvedNetteAddComponentCalls(owner.source)
  ) {
    return null;
  }

  return owner;
}

async function factoryHierarchyIsFresh(
  context: NettePresenterLinkDiagnosticContext,
  hierarchy: NetteFactoryTemplateOwnerHierarchy,
): Promise<boolean> {
  for (const entry of hierarchy.sources) {
    if (!isResolutionCurrent(context)) {
      return false;
    }

    let currentSource: string;

    try {
      currentSource = await context.deps.readFileContent(entry.path);
    } catch {
      return false;
    }

    if (!isResolutionCurrent(context) || currentSource !== entry.source) {
      return false;
    }
  }

  return true;
}

function hasDirectNetteUiParent(
  source: string,
  className: string,
  bodyStartOffset: number,
): boolean {
  const header = source.slice(0, bodyStartOffset);
  const declaration = new RegExp(
    `\\bclass\\s+${escapeRegExp(className)}\\b[^{}]*?\\bextends\\s+([\\\\A-Za-z_][\\\\A-Za-z0-9_]*)`,
    "g",
  );
  let parent: string | null = null;

  for (const match of header.matchAll(declaration)) {
    parent = match[1] ?? null;
  }

  if (
    parent === "\\Nette\\Application\\UI\\Presenter" ||
    parent === "\\Nette\\Application\\UI\\Control"
  ) {
    return true;
  }

  if (!parent || parent.includes("\\")) {
    return false;
  }

  const importPattern =
    /^\s*use\s+(Nette\\Application\\UI\\(?:Presenter|Control))(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/gim;

  for (const match of header.matchAll(importPattern)) {
    const imported = match[1];
    const alias = match[2] ?? imported?.split("\\").pop();

    if (alias === parent) {
      return true;
    }
  }

  return false;
}

function exactOwner(path: string, source: string, className: string): ComponentOwner | null {
  const exactNames = phpTopLevelTypeDeclarationNames(source).filter(
    (declared) => declared === className,
  );

  if (exactNames.length !== 1) {
    return null;
  }

  const structure = parsePhpClassStructure(source, className);

  if (
    !structure.typeDeclaration ||
    (structure.kind !== "class" && structure.kind !== "abstract-class")
  ) {
    return null;
  }

  return { className, path, source };
}

function missingFactoryDiagnostic(
  lineStarts: readonly number[],
  reference: NetteStaticComponentFactoryReference,
  owner: ComponentOwner,
): LanguageServerDiagnostic {
  const start = lineColumnAt(lineStarts, reference.start);
  const end = lineColumnAt(lineStarts, reference.end);
  const methodName = netteCreateComponentMethodName(reference.name);
  const data: NetteComponentFactoryDiagnosticData = {
    componentName: reference.name,
    kind: "missing-component-factory",
    methodName,
    ownerPath: owner.path,
    target: reference.name,
    usageKind: reference.kind,
  };

  return {
    character: start.column - 1,
    code: "nette.missingComponentFactory",
    data,
    endCharacter: end.column - 1,
    endLine: end.lineNumber - 1,
    line: start.lineNumber - 1,
    message: `Nette component ${reference.name} resolves to ${owner.path}, but ${methodName} was not found.`,
    severity: "warning",
    source: "Nette",
  };
}

function isResolutionCurrent(context: NettePresenterLinkDiagnosticContext): boolean {
  return (
    context.isRequestedRootActive() && (context.isPresenterMappingGenerationCurrent?.() ?? true)
  );
}

function phpClassNameFromPath(path: string): string | null {
  const fileName = path.split(/[\\/]/).pop();

  if (!fileName?.endsWith(".php")) {
    return null;
  }

  const className = fileName.slice(0, -".php".length);

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(className) ? className : null;
}

function shortClassName(className: string): string {
  return className.split("\\").pop() ?? className;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
