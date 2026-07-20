import {
  phpFrameworkTranslationLiteralTarget,
  phpFrameworkTranslationMissingTargetMessage,
  phpFrameworkTranslationReferenceAt,
} from "../domain/phpFrameworkLiteralDispatch";
import type { PhpFrameworkLiteralDefinitionResolverEntry } from "./phpFrameworkLiteralDefinitionResolverRegistry";

export const phpTranslationLiteralDefinitionResolver: PhpFrameworkLiteralDefinitionResolverEntry =
  {
    id: "framework.translation",
    missingContextualMessage: ({ providers, request }) => {
      if (request.kind !== "translation") {
        return undefined;
      }

      return phpFrameworkTranslationMissingTargetMessage(request.key, providers);
    },
    resolveDirect: async ({ position, providers, source }, dependencies) => {
      const reference = phpFrameworkTranslationReferenceAt(
        source,
        position,
        providers,
      );

      if (!reference) {
        return undefined;
      }

      if (!phpFrameworkTranslationLiteralTarget(reference.key, providers)) {
        return null;
      }

      const target = await dependencies.findTranslationTarget(reference.key);

      return target
        ? {
            kind: "translation",
            label: target.key,
            path: target.path,
            position: target.position,
          }
        : null;
    },
    resolveContextual: async ({ request }, dependencies) => {
      if (request.kind !== "translation") {
        return undefined;
      }

      const target = await dependencies.findTranslationTarget(request.key);

      return target
        ? {
            kind: "translation",
            label: target.key,
            path: target.path,
            position: target.position,
          }
        : null;
    },
  };
