import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  latteMemberReferenceAt,
  latteVariableNameAt,
  type LatteExpressionNavigation,
} from "./latteExpressionDetection";
import type { NetteViewDataEntry } from "./netteViewDataEntries";
import { matchesLatteViewName } from "./netteViewDataEntries";
import {
  orderPhpMemberCompletionsByCategory,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";

export interface LatteExpressionDefinitionDependencies {
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
  deps: LatteExpressionDefinitionDependencies;
  isRequestedRootActive(): boolean;
  loadViewDataEntries(): Promise<NetteViewDataEntry[]>;
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
