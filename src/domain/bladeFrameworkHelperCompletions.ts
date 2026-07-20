import type { EditorPosition } from "./languageServerFeatures";
import {
  type PhpFrameworkProvider,
  type PhpFrameworkConfigReference,
  type PhpFrameworkRouteReference,
  type PhpFrameworkStringLiteralHelperMatch,
  type PhpFrameworkTranslationReference,
} from "./phpFrameworkProviders";
import { phpFrameworkStringLiteralHelperAt } from "./phpFrameworkLiteralDispatch";

export type BladeFrameworkHelperCompletionContext =
  | {
      kind: "route";
      position: EditorPosition;
      prefix: string;
      providerId: string;
      source: string;
    }
  | {
      kind: "config";
      position: EditorPosition;
      prefix: string;
      providerId: string;
      source: string;
    }
  | {
      kind: "trans";
      position: EditorPosition;
      prefix: string;
      providerId: string;
      source: string;
    };

interface BladeEchoSpan {
  contentStart: number;
  contentEnd: number;
}

export function bladeFrameworkHelperCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[],
): BladeFrameworkHelperCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const echoSpan = innermostBladeEchoSpanAt(source, offset);

  if (!echoSpan) {
    return bladeFrameworkHelperContextFromScannerInput(
      source,
      offset,
      providers,
    );
  }

  const echoSource = source.slice(echoSpan.contentStart, echoSpan.contentEnd);
  const echoOffset = offset - echoSpan.contentStart;

  return bladeFrameworkHelperContextFromScannerInput(
    echoSource,
    echoOffset,
    providers,
  );
}

export function bladeFrameworkStringLiteralHelperAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[],
): PhpFrameworkStringLiteralHelperMatch | null {
  const echoSpan = innermostBladeEchoSpanAt(source, offset);

  if (!echoSpan) {
    return phpFrameworkStringLiteralHelperAt(source, offset, providers);
  }

  const echoSource = source.slice(echoSpan.contentStart, echoSpan.contentEnd);
  const echoOffset = offset - echoSpan.contentStart;
  const match = phpFrameworkStringLiteralHelperAt(
    echoSource,
    echoOffset,
    providers,
  );

  if (!match) {
    return null;
  }

  return {
    ...match,
    literalEnd: echoSpan.contentStart + match.literalEnd,
    literalStart: echoSpan.contentStart + match.literalStart,
  };
}

function bladeFrameworkHelperContextFromScannerInput(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[],
): BladeFrameworkHelperCompletionContext | null {
  const position = positionAtOffset(source, offset);
  const route = firstProviderMatch(providers, (provider) =>
    provider.routes?.referenceAt?.({ position, source }),
  );

  if (route) {
    return {
      kind: "route",
      position,
      prefix: route.match.prefix,
      providerId: route.providerId,
      source,
    };
  }

  const translation = firstProviderMatch(providers, (provider) =>
    provider.translations?.referenceAt?.({ position, source }),
  );

  if (translation) {
    return {
      kind: "trans",
      position,
      prefix: translation.match.prefix,
      providerId: translation.providerId,
      source,
    };
  }

  const config = firstProviderMatch(providers, (provider) =>
    provider.config?.referenceAt?.({ position, source }),
  );

  if (config) {
    return {
      kind: "config",
      position,
      prefix: config.match.prefix,
      providerId: config.providerId,
      source,
    };
  }

  return null;
}

function firstProviderMatch<
  T extends
    | PhpFrameworkConfigReference
    | PhpFrameworkRouteReference
    | PhpFrameworkTranslationReference,
>(
  providers: readonly PhpFrameworkProvider[],
  scan: (provider: PhpFrameworkProvider) => T | null | undefined,
): { match: T; providerId: string } | null {
  for (const provider of providers) {
    const match = scan(provider);

    if (match) {
      return { match, providerId: provider.id };
    }
  }

  return null;
}

function innermostBladeEchoSpanAt(
  source: string,
  offset: number,
): BladeEchoSpan | null {
  let bestSpan: BladeEchoSpan | null = null;

  for (const [open, close] of [
    ["{{", "}}"],
    ["{!!", "!!}"],
  ] as const) {
    for (let searchFrom = offset - 1; searchFrom >= 0; ) {
      const openIndex = source.lastIndexOf(open, searchFrom);

      if (openIndex < 0) {
        break;
      }

      const contentStart = openIndex + open.length;
      const closeIndex = source.indexOf(close, contentStart);
      const contentEnd = closeIndex < 0 ? source.length : closeIndex;

      if (offset >= contentStart && offset <= contentEnd) {
        if (!bestSpan || contentStart > bestSpan.contentStart) {
          bestSpan = { contentEnd, contentStart };
        }

        break;
      }

      searchFrom = openIndex - 1;
    }
  }

  return bestSpan;
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let column = 1;
  let line = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function positionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < clamped; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return { column: clamped - lineStart + 1, lineNumber };
}
