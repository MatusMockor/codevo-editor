import {
  phpMethodCompletionsFromSource,
  type PhpMethodCompletion,
  type PhpMethodCompletionOptions,
} from "../domain/phpMethodCompletions";

export interface PhpMemberCompletionContributionContext {
  readonly declaringClassName: string;
  readonly source: string;
  readonly workspaceSources: readonly string[];
}

export interface PhpMemberCompletionContribution {
  readonly id: string;
  readonly priority?: number;
  collect(
    context: PhpMemberCompletionContributionContext,
  ): readonly PhpMethodCompletion[];
  replaces?(
    existing: PhpMethodCompletion,
    replacement: PhpMethodCompletion,
    context: PhpMemberCompletionContributionContext,
  ): boolean;
}

export interface PhpMemberCompletionContributionIdentity {
  signature(
    contributions: readonly PhpMemberCompletionContribution[],
  ): string;
}

export function createPhpMemberCompletionContributionIdentity(): PhpMemberCompletionContributionIdentity {
  const identities = new WeakMap<PhpMemberCompletionContribution, number>();
  let nextIdentity = 1;

  return {
    signature: (contributions) =>
      contributions
        .map((contribution) => {
          let identity = identities.get(contribution);

          if (identity === undefined) {
            identity = nextIdentity;
            nextIdentity += 1;
            identities.set(contribution, identity);
          }

          return `${contribution.id}:${contribution.priority ?? 0}:${identity}`;
        })
        .join("|"),
  };
}

export function phpMemberCompletionContributionSignature(
  contributions: readonly PhpMemberCompletionContribution[],
): string {
  return contributions
    .map(({ id, priority = 0 }) => `${id}:${priority}`)
    .join("|");
}

export interface PhpMemberCompletionCollector {
  collect(
    source: string,
    declaringClassName: string,
    options?: PhpMethodCompletionOptions,
    workspaceSources?: readonly string[],
  ): PhpMethodCompletion[];
}

export function createPhpMemberCompletionCollector(
  contributions: readonly PhpMemberCompletionContribution[],
): PhpMemberCompletionCollector {
  return {
    collect: (
      source,
      declaringClassName,
      options = {},
      workspaceSources = [],
    ) => {
      const context = { declaringClassName, source, workspaceSources };
      let completions = phpMethodCompletionsFromSource(
        source,
        declaringClassName,
        options,
      );

      for (const contribution of contributions) {
        completions = mergePhpMemberCompletionContribution(
          completions,
          contribution.collect(context),
          contribution,
          context,
        );
      }

      return completions;
    },
  };
}

function mergePhpMemberCompletionContribution(
  existing: readonly PhpMethodCompletion[],
  contributed: readonly PhpMethodCompletion[],
  contribution: PhpMemberCompletionContribution,
  context: PhpMemberCompletionContributionContext,
): PhpMethodCompletion[] {
  const merged = [...existing];

  for (const replacement of contributed) {
    const replacementIndex = contribution.replaces
      ? merged.findIndex((candidate) =>
          contribution.replaces?.(candidate, replacement, context),
        )
      : -1;

    if (replacementIndex >= 0) {
      merged[replacementIndex] = replacement;
      continue;
    }

    if (
      merged.some(
        (candidate) =>
          phpMemberCompletionKey(candidate) ===
          phpMemberCompletionKey(replacement),
      )
    ) {
      continue;
    }

    merged.push(replacement);
  }

  return merged;
}

export function mergePhpMemberCompletions(
  ...groups: readonly (readonly PhpMethodCompletion[])[]
): PhpMethodCompletion[] {
  const seen = new Set<string>();
  const merged: PhpMethodCompletion[] = [];

  for (const group of groups) {
    for (const completion of group) {
      const key = phpMemberCompletionKey(completion);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(completion);
    }
  }

  return merged;
}

function phpMemberCompletionKey(completion: PhpMethodCompletion): string {
  return [
    completion.kind ?? "method",
    completion.name.toLowerCase(),
    completion.isStatic ? "static" : "instance",
    completion.parameters.replace(/\s+/g, " ").trim(),
  ].join(":");
}
