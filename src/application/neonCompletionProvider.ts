import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  neonServiceClassCompletionContextAt,
} from "../domain/neonConfig";
import {
  neonGeneratedServiceNamesFromServices,
  neonParameterCompletionContextAt,
  neonParametersFromSource,
  neonServiceReferenceCompletionContextAt,
  neonServiceSetupMethodCompletionContextAt,
  neonServicesFromSource,
} from "../domain/netteDiContainer";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import type { NeonCompletionItem } from "./neonCompletionItems";
import {
  loadNeonProjectConfig,
  neonResolvableServiceType,
} from "./neonProjectConfigDiscovery";
import {
  offsetAtEditorPosition,
  type NeonRequestContext,
  type NeonRuntimeDependencies,
} from "./neonIntelligenceRuntime";

const NEON_MAX_COMPLETIONS = 100;

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

/**
 * `%param%` completion: the merged parameter names (current file + cross-file
 * project config), filtered by the typed prefix. The post-await live-root
 * re-check drops a switched project's result.
 */
async function neonParameterCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
  completion: { prefix: string; span: { end: number; start: number } },
): Promise<NeonCompletionItem[]> {
  const names = await collectNeonParameterNames(context, source);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Nette parameter",
      insertText: name,
      kind: "parameter" as const,
      label: name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

/**
 * `@service` completion: the merged service names (current file + cross-file
 * project config), filtered by the typed prefix.
 */
async function neonServiceReferenceCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
  completion: { prefix: string; span: { end: number; start: number } },
): Promise<NeonCompletionItem[]> {
  const names = await collectNeonServiceNames(context, source);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Nette service",
      insertText: name,
      kind: "service" as const,
      label: name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

/**
 * `setup:` method completion: infer the owning service class from the service
 * entry (`class:`, `type:`, class-valued `factory:` / `create:`), then reuse the
 * PHP member-completion engine through a synthetic typed receiver. This keeps
 * Nette config completion consistent with `$service->` in PHP without adding a
 * second method-index implementation here.
 */
async function neonServiceSetupMethodCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  completion: {
    prefix: string;
    service: { className: string | null; factory: string | null };
    span: { end: number; start: number };
  },
): Promise<NeonCompletionItem[]> {
  const serviceType = neonResolvableServiceType(completion.service);

  if (!serviceType) {
    return [];
  }

  const synthetic = context.deps.synthesizeTypedReceiverSource(
    "service",
    serviceType,
  );
  const members = await context.deps.resolvePhpReceiverCompletions(
    synthetic.source,
    synthetic.position,
    "$service->",
  );

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return orderPhpMemberCompletionsByCategory(members)
    .filter(isCallablePhpMethodCompletion)
    .filter((member) => member.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((member) => ({
      detail: neonSetupMethodCompletionDetail(member),
      insertText: neonSetupMethodCompletionInsertText(member),
      kind: "method" as const,
      label: member.name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

function isCallablePhpMethodCompletion(member: PhpMethodCompletion): boolean {
  return member.kind !== "property" && member.kind !== "relation";
}

function neonSetupMethodCompletionInsertText(member: PhpMethodCompletion): string {
  if (member.insertText) {
    return member.insertText;
  }

  return `${member.name}()`;
}

function neonSetupMethodCompletionDetail(member: PhpMethodCompletion): string {
  const parameters = member.parameters ? `(${member.parameters})` : "()";
  const returnType = member.returnType ? `: ${member.returnType}` : "";

  return `${member.declaringClassName}::${member.name}${parameters}${returnType}`;
}

/** Merged parameter names: current file (no I/O) unioned with the project config. */
async function collectNeonParameterNames(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
): Promise<string[]> {
  const names = new Set<string>();

  for (const parameter of neonParametersFromSource(source)) {
    names.add(parameter.name);
  }

  const config = await loadNeonProjectConfig(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  for (const name of config.parameterNames) {
    names.add(name);
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

/** Merged service names: current file (no I/O) unioned with the project config. */
async function collectNeonServiceNames(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
): Promise<string[]> {
  const names = new Set<string>();
  const services = neonServicesFromSource(source);

  for (const service of services) {
    if (service.serviceName) {
      names.add(service.serviceName);
    }

    const serviceType = neonResolvableServiceType(service);

    if (serviceType) {
      names.add(serviceType);
    }
  }

  for (const generated of neonGeneratedServiceNamesFromServices(services)) {
    names.add(generated.name);
  }

  const config = await loadNeonProjectConfig(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  for (const name of config.serviceNames) {
    names.add(name);
  }

  for (const name of config.serviceTypes.keys()) {
    names.add(name);
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}
