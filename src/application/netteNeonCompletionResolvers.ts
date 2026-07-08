import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import { NEON_MAX_COMPLETIONS } from "./neonCompletionLimits";
import type { NeonCompletionDependencies } from "./neonCompletionProvider";
import type { NeonCompletionItem } from "./neonCompletionItems";
import type { NeonRequestContext } from "./neonIntelligenceRuntime";
import {
  neonParameterNamesFromSource,
  neonServiceNamesFromSource,
} from "./netteNeonConfigFacts";
import {
  loadNeonProjectConfig,
  neonResolvableServiceType,
} from "./neonProjectConfigDiscovery";

interface NeonTextCompletion {
  prefix: string;
  span: { end: number; start: number };
}

/**
 * `%param%` completion: the merged parameter names (current file + cross-file
 * project config), filtered by the typed prefix. The post-await live-root
 * re-check drops a switched project's result.
 */
export async function neonParameterCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
  completion: NeonTextCompletion,
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
export async function neonServiceReferenceCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
  completion: NeonTextCompletion,
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
export async function neonServiceSetupMethodCompletions(
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

  for (const name of neonParameterNamesFromSource(source)) {
    names.add(name);
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

  for (const name of neonServiceNamesFromSource(source)) {
    names.add(name);
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
