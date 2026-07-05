import { useCallback } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMethodParameters,
  phpMethodSignatureContextAt,
  type PhpMethodCompletion,
  type PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import {
  phpCallArgumentInlayContexts,
  phpParameterNameInlayHints,
  type PhpParameterNameInlayHint,
} from "../domain/phpInlayHints";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

// Upper bound on the number of PHP call expressions whose target signature is
// resolved per inlay-hints viewport request. Keeps a dense file from fanning out
// an unbounded number of signature resolutions on every scroll; calls beyond the
// cap simply receive no parameter-name hint until they scroll into a fresh
// viewport window.
const PHP_INLAY_HINT_CALL_LIMIT = 40;

interface UsePhpSignatureHelpProviderOptions {
  currentWorkspaceRootRef: { readonly current: string | null };
  resolvePhpReceiverMethodCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  resolvePhpStaticMethodCompletions(
    source: string,
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  workspaceRoot: string | null;
}

export interface PhpSignatureHelpProvider {
  providePhpMethodSignature(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodSignature | null>;
  providePhpParameterInlayHints(
    source: string,
    range: { endLine: number; startLine: number },
  ): Promise<PhpParameterNameInlayHint[]>;
}

export function usePhpSignatureHelpProvider({
  currentWorkspaceRootRef,
  resolvePhpReceiverMethodCompletions,
  resolvePhpStaticMethodCompletions,
  workspaceRoot,
}: UsePhpSignatureHelpProviderOptions): PhpSignatureHelpProvider {
  const providePhpMethodSignature = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<PhpMethodSignature | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return null;
      }

      const signatureContext = phpMethodSignatureContextAt(source, position);

      if (!signatureContext) {
        return null;
      }

      const methods = signatureContext.className
        ? await resolvePhpStaticMethodCompletions(source, signatureContext.className)
        : signatureContext.receiverExpression
          ? await resolvePhpReceiverMethodCompletions(
              source,
              position,
              signatureContext.receiverExpression,
            )
          : [];

      if (!isRequestedRootActive()) {
        return null;
      }

      const method = methods.find(
        (candidate) =>
          candidate.name.toLowerCase() ===
          signatureContext.methodName.toLowerCase(),
      );

      if (!method) {
        return null;
      }

      const parameters = phpMethodParameters(method.parameters);
      const namedArgumentIndex = signatureContext.argumentName
        ? parameters.findIndex(
            (parameter) => parameter.name === `$${signatureContext.argumentName}`,
          )
        : -1;

      return {
        argumentIndex:
          namedArgumentIndex >= 0
            ? namedArgumentIndex
            : signatureContext.argumentIndex,
        method: phpMethodCompletionWithStableMetadata(method),
        parameters,
      };
    },
    [
      currentWorkspaceRootRef,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      workspaceRoot,
    ],
  );

  const providePhpParameterInlayHints = useCallback(
    async (
      source: string,
      range: { endLine: number; startLine: number },
    ): Promise<PhpParameterNameInlayHint[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const calls = phpCallArgumentInlayContexts(source, range);

      if (calls.length === 0) {
        return [];
      }

      // Cap the calls resolved per viewport so a dense file does not fan out an
      // unbounded number of signature resolutions on every scroll.
      const hints: PhpParameterNameInlayHint[] = [];

      for (const call of calls.slice(0, PHP_INLAY_HINT_CALL_LIMIT)) {
        const firstArgument = call.arguments[0];

        if (!firstArgument) {
          continue;
        }

        // Reuse the signature-resolution flow by probing a position inside the
        // call's argument list; it resolves method / static / receiver targets
        // (free functions resolve to null, so they yield no hint).
        const signature = await providePhpMethodSignature(source, {
          column: firstArgument.character + 1,
          lineNumber: firstArgument.line + 1,
        });

        if (!isRequestedRootActive()) {
          return [];
        }

        if (!signature) {
          continue;
        }

        hints.push(...phpParameterNameInlayHints(call, signature.parameters));
      }

      return hints;
    },
    [
      currentWorkspaceRootRef,
      providePhpMethodSignature,
      workspaceRoot,
    ],
  );

  return {
    providePhpMethodSignature,
    providePhpParameterInlayHints,
  };
}

function phpMethodCompletionWithStableMetadata(
  completion: PhpMethodCompletion,
): PhpMethodCompletion {
  if (!completion.visibility) {
    return completion;
  }

  const { visibility, ...stableCompletion } = completion;

  Object.defineProperty(stableCompletion, "visibility", {
    configurable: true,
    enumerable: false,
    value: visibility,
  });

  return stableCompletion;
}
