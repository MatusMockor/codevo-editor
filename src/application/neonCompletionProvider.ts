import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  neonServiceClassCompletionContextAt,
} from "../domain/neonConfig";
import {
  neonConfigKeyCompletionContextAt,
  neonConfigKeySpecsForScope,
  neonExtensionNamesFromSource,
  neonIndentUnitFromSource,
  type NeonConfigKeyCompletionContext,
  type NeonConfigKeySpec,
} from "../domain/neonConfigSchema";
import {
  neonParameterCompletionContextAt,
  neonServiceReferenceCompletionContextAt,
  neonServiceSetupMethodCompletionContextAt,
} from "../domain/netteDiContainer";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { NEON_MAX_COMPLETIONS } from "./neonCompletionLimits";
import type { NeonCompletionItem } from "./neonCompletionItems";
import {
  neonParameterCompletions,
  neonServiceReferenceCompletions,
  neonServiceSetupMethodCompletions,
} from "./netteNeonCompletionResolvers";
import {
  offsetAtEditorPosition,
  type NeonRequestContext,
  type NeonRuntimeDependencies,
} from "./neonIntelligenceRuntime";

export interface NeonCompletionDependencies extends NeonRuntimeDependencies {
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  searchClassNames(
    rootPath: string,
    prefix: string,
    maxResults: number,
  ): Promise<string[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
}

export async function provideNeonCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
  position: EditorPosition,
): Promise<NeonCompletionItem[]> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const offset = offsetAtEditorPosition(source, position);

  const parameterCompletion = neonParameterCompletionContextAt(source, offset);

  if (parameterCompletion) {
    return neonParameterCompletions(context, source, parameterCompletion);
  }

  const serviceCompletion = neonServiceReferenceCompletionContextAt(
    source,
    offset,
  );

  if (serviceCompletion) {
    return neonServiceReferenceCompletions(context, source, serviceCompletion);
  }

  const setupMethodCompletion = neonServiceSetupMethodCompletionContextAt(
    source,
    offset,
  );

  if (setupMethodCompletion) {
    return neonServiceSetupMethodCompletions(context, setupMethodCompletion);
  }

  const keyCompletion = neonConfigKeyCompletionContextAt(source, offset);

  if (keyCompletion) {
    return neonConfigKeyCompletions(source, keyCompletion);
  }

  const classContext = neonServiceClassCompletionContextAt(source, offset);

  if (!classContext) {
    return [];
  }

  const names = await deps.searchClassNames(
    requestedRoot,
    classContext.prefix,
    NEON_MAX_COMPLETIONS,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  return names.slice(0, NEON_MAX_COMPLETIONS).map((name) => ({
    detail: "Nette service class",
    insertText: name,
    kind: "class" as const,
    label: name,
    replaceEnd: classContext.span.end,
    replaceStart: classContext.span.start,
  }));
}

function neonConfigKeyCompletions(
  source: string,
  completion: NeonConfigKeyCompletionContext,
): NeonCompletionItem[] {
  const normalizedPrefix = completion.prefix.toLowerCase();
  const indentUnit = neonIndentUnitFromSource(source);

  return neonConfigKeySpecs(source, completion)
    .filter((spec) => spec.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((spec) => ({
      detail: spec.description,
      insertText: neonConfigKeyInsertText(spec, completion, indentUnit),
      kind: "parameter" as const,
      label: spec.name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

function neonConfigKeySpecs(
  source: string,
  completion: NeonConfigKeyCompletionContext,
): NeonConfigKeySpec[] {
  const specs = [...neonConfigKeySpecsForScope(completion.scope)];

  if (completion.scope.kind !== "top-level") {
    return specs;
  }

  const knownNames = new Set(specs.map((spec) => spec.name.toLowerCase()));

  for (const name of neonExtensionNamesFromSource(source)) {
    if (knownNames.has(name.toLowerCase())) {
      continue;
    }

    knownNames.add(name.toLowerCase());
    specs.push({
      description: `Configuration of the ${name} extension`,
      name,
      valueKind: "section",
    });
  }

  return specs;
}

function neonConfigKeyInsertText(
  spec: NeonConfigKeySpec,
  completion: NeonConfigKeyCompletionContext,
  indentUnit: string,
): string {
  if (completion.followedByColon) {
    return spec.name;
  }

  if (completion.scope.kind === "top-level" && spec.valueKind === "section") {
    return `${spec.name}:\n${indentUnit}`;
  }

  return `${spec.name}: `;
}
