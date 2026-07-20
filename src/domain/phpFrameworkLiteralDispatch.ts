import type { EditorPosition } from "./languageServerFeatures";
import type {
  PhpFrameworkConfigCompletionContext,
  PhpFrameworkConfigKey,
  PhpFrameworkConfigReference,
  PhpFrameworkEnvCompletionContext,
  PhpFrameworkEnvEntry,
  PhpFrameworkEnvReference,
  PhpFrameworkInertiaCompletionContext,
  PhpFrameworkInertiaReference,
  PhpFrameworkResolvedLiteralTarget,
  PhpFrameworkResolvedScopedStringCompletion,
  PhpFrameworkStringLiteralHelperMatch,
  PhpFrameworkTranslationCompletionContext,
  PhpFrameworkTranslationKey,
  PhpFrameworkTranslationReference,
} from "./phpFrameworkProviders";
import type { PhpFrameworkLiteralCapabilityPort } from "./phpFrameworkDispatchPorts";

export function phpFrameworkRouteMissingTargetMessage(
  name: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): string | null {
  for (const provider of providers) {
    const message = provider.routes?.missingTargetMessage?.({ name });

    if (message) {
      return message;
    }
  }

  return null;
}

export function phpFrameworkConfigReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkConfigReference | null {
  return (
    phpFrameworkConfigCompletionContextAt(source, position, providers)
      ?.reference ?? null
  );
}

export function phpFrameworkConfigCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkConfigCompletionContext | null {
  for (const provider of providers) {
    const reference = provider.config?.referenceAt?.({ position, source });

    if (reference) {
      return { provider, reference };
    }
  }

  return null;
}

export function phpFrameworkConfigKeysFromSource(
  source: string,
  fileName: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkConfigKey[] {
  return providers.flatMap(
    (provider) => provider.config?.keysFromSource?.({ fileName, source }) ?? [],
  );
}

export function phpFrameworkConfigTargetFromSource(
  source: string,
  fileName: string,
  key: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkConfigKey | null {
  for (const provider of providers) {
    const target = provider.config?.targetFromSource?.({
      fileName,
      key,
      source,
    });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkConfigLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.config?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkConfigMissingTargetMessage(
  key: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): string | null {
  for (const provider of providers) {
    const message = provider.config?.missingTargetMessage?.({ key });

    if (message) {
      return message;
    }
  }

  return null;
}

export function phpFrameworkEnvReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkEnvReference | null {
  return (
    phpFrameworkEnvCompletionContextAt(source, position, providers)
      ?.reference ?? null
  );
}

export function phpFrameworkEnvCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkEnvCompletionContext | null {
  for (const provider of providers) {
    const reference = provider.env?.referenceAt?.({ position, source });

    if (reference) {
      return { provider, reference };
    }
  }

  return null;
}

export function phpFrameworkEnvEntriesFromSource(
  source: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkEnvEntry[] {
  return providers.flatMap(
    (provider) => provider.env?.entriesFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkEnvTargetFromSource(
  source: string,
  name: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkEnvEntry | null {
  for (const provider of providers) {
    const target = provider.env?.targetFromSource?.({ name, source });

    if (target) {
      return target;
    }

    if (!provider.env?.targetFromSource) {
      const entry = provider.env
        ?.entriesFromSource?.({ source })
        .find((candidate) => candidate.name === name);

      if (entry) {
        return entry;
      }
    }
  }

  return null;
}

export function phpFrameworkEnvLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.env?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkEnvMissingTargetMessage(
  name: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): string | null {
  for (const provider of providers) {
    const message = provider.env?.missingTargetMessage?.({ name });

    if (message) {
      return message;
    }
  }

  return null;
}

export function phpFrameworkTranslationReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkTranslationReference | null {
  return (
    phpFrameworkTranslationCompletionContextAt(source, position, providers)
      ?.reference ?? null
  );
}

export function phpFrameworkTranslationCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkTranslationCompletionContext | null {
  for (const provider of providers) {
    const reference = provider.translations?.referenceAt?.({
      position,
      source,
    });

    if (reference) {
      return { provider, reference };
    }
  }

  return null;
}

export function phpFrameworkTranslationKeysFromSource(
  source: string,
  fileName: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkTranslationKey[] {
  return providers.flatMap(
    (provider) =>
      provider.translations?.keysFromSource?.({ fileName, source }) ?? [],
  );
}

export function phpFrameworkTranslationTargetFromSource(
  source: string,
  fileName: string,
  key: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkTranslationKey | null {
  for (const provider of providers) {
    const target = provider.translations?.targetFromSource?.({
      fileName,
      key,
      source,
    });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkTranslationLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.translations?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkTranslationMissingTargetMessage(
  key: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): string | null {
  for (const provider of providers) {
    const message = provider.translations?.missingTargetMessage?.({ key });

    if (message) {
      return message;
    }
  }

  return null;
}

export function phpFrameworkJsonTranslationKeysFromSource(
  source: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkTranslationKey[] {
  return providers.flatMap(
    (provider) => provider.translations?.jsonKeysFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkJsonTranslationTargetFromSource(
  source: string,
  key: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkTranslationKey | null {
  for (const provider of providers) {
    const target = provider.translations?.jsonTargetFromSource?.({
      key,
      source,
    });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkInertiaReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkInertiaReference | null {
  return (
    phpFrameworkInertiaCompletionContextAt(source, position, providers)
      ?.reference ?? null
  );
}

export function phpFrameworkInertiaCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkInertiaCompletionContext | null {
  for (const provider of providers) {
    const reference = provider.inertia?.referenceAt?.({ position, source });

    if (reference) {
      return { provider, reference };
    }
  }

  return null;
}

export function phpFrameworkInertiaLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.inertia?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkStringLiteralHelperAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkStringLiteralHelperMatch | null {
  for (const provider of providers) {
    const match = provider.stringLiterals?.helperAt?.({ offset, source });

    if (match) {
      return { ...match, providerId: provider.id };
    }
  }

  return null;
}

export function phpFrameworkScopedStringCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): boolean {
  return providers.some(
    (provider) =>
      Boolean(provider.translations?.referenceAt?.({ position, source })) ||
      (provider.php?.isScopedStringCompletionContext?.({ position, source }) ??
        false),
  );
}

export function phpFrameworkScopedStringCompletionAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkLiteralCapabilityPort[],
): PhpFrameworkResolvedScopedStringCompletion | null {
  for (const provider of providers) {
    const completion = provider.php?.scopedStringCompletionAt?.({
      position,
      source,
    });
    const insertText = provider.php?.scopedStringCompletionInsertText;

    if (completion && insertText) {
      return {
        ...completion,
        insertText: (name) => insertText({ kind: completion.kind, name }),
        providerId: provider.id,
      };
    }
  }

  return null;
}
