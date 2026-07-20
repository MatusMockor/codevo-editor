import type { EditorPosition } from "./languageServerFeatures";
import type {
  PhpFrameworkPhpPresenterLink,
  PhpFrameworkPhpPresenterLinkCompletion,
  PhpFrameworkResolvedLiteralTarget,
  PhpFrameworkViewCompletionContext,
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewReference,
} from "./phpFrameworkProviders";
import type { PhpFrameworkTemplateCapabilityPort } from "./phpFrameworkDispatchPorts";
import { phpFrameworkTargetSearchQueries } from "./phpFrameworkTargetCapabilities";

export function phpFrameworkViewReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): PhpFrameworkViewReference | null {
  return (
    phpFrameworkViewCompletionContextAt(source, position, providers)
      ?.reference ?? null
  );
}

export function phpFrameworkViewCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): PhpFrameworkViewCompletionContext | null {
  for (const provider of providers) {
    const reference = provider.templating?.referenceAt?.({ position, source });

    if (reference) {
      return { provider, reference };
    }
  }

  return null;
}

export function phpFrameworkViewLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.templating?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkViewMissingTargetMessage(
  name: string,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): string | null {
  for (const provider of providers) {
    const message = provider.templating?.missingTargetMessage?.({ name });

    if (message) {
      return message;
    }
  }

  return null;
}

export function phpFrameworkTemplateNameFromRelativePath(
  relativePath: string,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): string | null {
  for (const provider of providers) {
    const templateName = provider.templating?.templateNameFromRelativePath?.({
      relativePath,
    });

    if (templateName) {
      return templateName;
    }
  }

  return null;
}

export function phpFrameworkViewDataEntryFromSource(
  source: string,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): PhpFrameworkViewDataEntry | null {
  for (const provider of providers) {
    const entry = provider.viewData?.entryFromSource?.({ source });

    if (entry) {
      return entry;
    }
  }

  return null;
}

export function phpFrameworkViewDataSearchQueries(
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): readonly string[] {
  return phpFrameworkTargetSearchQueries("viewData", providers);
}

export function phpFrameworkPhpPresenterLinkAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): PhpFrameworkPhpPresenterLink | null {
  for (const provider of providers) {
    const link = provider.php?.presenterLinkAt?.({ offset, source });

    if (link) {
      return link;
    }
  }

  return null;
}

export function phpFrameworkPhpPresenterLinkCompletionAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkTemplateCapabilityPort[],
): PhpFrameworkPhpPresenterLinkCompletion | null {
  for (const provider of providers) {
    const completion = provider.php?.presenterLinkCompletionAt?.({
      offset,
      source,
    });

    if (completion) {
      return completion;
    }
  }

  return null;
}
