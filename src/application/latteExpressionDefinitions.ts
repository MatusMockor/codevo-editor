import type { EditorPosition } from "../domain/languageServerFeatures";
import { latteVariableDeclarations } from "../domain/latteSyntax";
import {
  latteMemberReferenceAt,
  latteVariableNameAt,
  type LatteExpressionNavigation,
} from "./latteExpressionDetection";
import type { NetteViewDataEntry } from "./netteViewDataEntries";
import { matchesLatteViewName } from "./netteViewDataEntries";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import { isLatteDeclarationVisibleAt } from "./latteVariableCandidates";
import {
  orderPhpMemberCompletionsByCategory,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";

export interface LatteExpressionDefinitionDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  openPhpMethodTarget(className: string, methodName: string): Promise<boolean>;
  openPhpPropertyTarget(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
}

export interface LatteExpressionDefinitionContext {
  currentTemplateRelativePath: string;
  deps: LatteExpressionDefinitionDependencies;
  isRequestedRootActive(): boolean;
  loadIncludedTemplateArguments(
    targetRelativePath: string,
  ): Promise<readonly NetteIncludedTemplateArgument[]>;
  loadViewDataEntries(): Promise<NetteViewDataEntry[]>;
  requestedRoot: string;
  resolveControlVariableDefinition(): Promise<boolean>;
  resolveVariableType(
    source: string,
    offset: number,
    variableName: string,
    depth: number,
  ): Promise<string | null>;
  viewNames(): Promise<string[]>;
}

export async function resolveNettePresenterVariableDefinition(
  context: LatteExpressionDefinitionContext,
  source: string,
  offset: number,
  navigation?: LatteExpressionNavigation,
): Promise<boolean> {
  const variableName = navigation
    ? navigation.variableName
    : latteVariableNameAt(source, offset);

  if (!variableName) {
    return false;
  }

  const localHandled = await resolveLocalVariableDefinition(
    context,
    source,
    offset,
    variableName,
  );

  if (localHandled) {
    return true;
  }

  const includeHandled = await resolveIncludedVariableDefinition(
    context,
    variableName,
  );

  if (includeHandled) {
    return true;
  }

  if (variableName === "control") {
    return context.resolveControlVariableDefinition();
  }

  const { deps, isRequestedRootActive } = context;
  const entries = await context.loadViewDataEntries();

  if (!isRequestedRootActive() || entries.length === 0) {
    return false;
  }

  const target = `$${variableName}`;
  const viewNames = await context.viewNames();

  if (!isRequestedRootActive()) {
    return false;
  }

  for (const entry of entries) {
    if (!entry.sourcePath) {
      continue;
    }

    for (const binding of entry.bindings) {
      if (!matchesLatteViewName(binding.viewName, viewNames)) {
        continue;
      }

      for (const variable of binding.variables) {
        if (variable.name !== target) {
          continue;
        }

        const position = editorPositionAtOffset(
          entry.source,
          variable.valueOffset ?? 0,
        );

        return deps.openTarget(entry.sourcePath, position, variable.name);
      }
    }
  }

  return false;
}

async function resolveLocalVariableDefinition(
  context: LatteExpressionDefinitionContext,
  source: string,
  offset: number,
  variableName: string,
): Promise<boolean> {
  if (!context.currentTemplateRelativePath) {
    return false;
  }

  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.variableName !== variableName) {
      continue;
    }

    if (!isLatteDeclarationVisibleAt(declaration, offset)) {
      continue;
    }

    const path = context.deps.joinPath(
      context.requestedRoot,
      context.currentTemplateRelativePath,
    );
    const position = editorPositionAtOffset(source, declaration.offset);

    return context.deps.openTarget(path, position, `$${variableName}`);
  }

  return false;
}

async function resolveIncludedVariableDefinition(
  context: LatteExpressionDefinitionContext,
  variableName: string,
): Promise<boolean> {
  const argumentsForTemplate = await context.loadIncludedTemplateArguments(
    context.currentTemplateRelativePath,
  );

  if (!context.isRequestedRootActive()) {
    return false;
  }

  for (const argument of argumentsForTemplate) {
    if (argument.name !== variableName) {
      continue;
    }

    const path = context.deps.joinPath(
      context.requestedRoot,
      argument.sourceTemplateRelativePath,
    );
    const position = await includedArgumentPosition(context, argument);

    if (!context.isRequestedRootActive()) {
      return false;
    }

    if (!position) {
      continue;
    }

    const opened = await context.deps.openTarget(
      path,
      position,
      `$${variableName}`,
    );

    if (!context.isRequestedRootActive() || opened) {
      return opened;
    }
  }

  return false;
}

async function includedArgumentPosition(
  context: LatteExpressionDefinitionContext,
  argument: NetteIncludedTemplateArgument,
): Promise<EditorPosition | null> {
  try {
    const path = context.deps.joinPath(
      context.requestedRoot,
      argument.sourceTemplateRelativePath,
    );
    const source = await context.deps.readFileContent(path);

    if (!context.isRequestedRootActive()) {
      return null;
    }

    return editorPositionAtOffset(source, argument.sourceSpan.start);
  } catch {
    return null;
  }
}

export async function resolveLatteMemberDefinition(
  context: LatteExpressionDefinitionContext,
  source: string,
  offset: number,
  navigation?: LatteExpressionNavigation,
): Promise<boolean> {
  const member = navigation
    ? navigation.memberReference
    : latteMemberReferenceAt(source, offset);

  if (!member) {
    return false;
  }

  const { deps, isRequestedRootActive } = context;
  const receiverType = await context.resolveVariableType(
    source,
    offset,
    member.variableName,
    0,
  );

  if (!isRequestedRootActive() || !receiverType) {
    return false;
  }

  const synthetic = deps.synthesizeTypedReceiverSource(
    member.variableName,
    receiverType,
  );
  const members = await deps.resolvePhpReceiverCompletions(
    synthetic.source,
    synthetic.position,
    member.receiverExpression,
  );

  if (!isRequestedRootActive()) {
    return false;
  }

  const resolved = orderPhpMemberCompletionsByCategory(members).find(
    (entry) => entry.name === member.memberName,
  );

  if (!resolved) {
    return false;
  }

  if (resolved.kind === "property") {
    return deps.openPhpPropertyTarget(
      resolved.declaringClassName || receiverType,
      member.memberName,
    );
  }

  const methodOpened = await deps.openPhpMethodTarget(
    resolved.declaringClassName || receiverType,
    member.memberName,
  );

  if (!isRequestedRootActive() || methodOpened) {
    return methodOpened;
  }

  if (resolved.kind === "relation") {
    return deps.openPhpPropertyTarget(
      resolved.declaringClassName || receiverType,
      member.memberName,
    );
  }

  return false;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
