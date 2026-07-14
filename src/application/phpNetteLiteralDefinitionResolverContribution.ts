import { detectNetteRedrawControlAt } from "../domain/netteAjaxSnippets";
import type {
  PhpFrameworkLiteralDefinitionResolverContribution,
  PhpFrameworkLiteralDefinitionResolverEntry,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";
import { phpTranslationLiteralDefinitionResolver } from "./phpTranslationLiteralDefinitionResolver";

const NETTE_LITERAL_DEFINITION_RESOLVERS: readonly PhpFrameworkLiteralDefinitionResolverEntry[] =
  [
    phpTranslationLiteralDefinitionResolver,
    {
      id: "nette.ajax-snippet",
      resolveDirect: async (
        { activeDocument, offset, source },
        dependencies,
      ) => {
        const redrawControl = detectNetteRedrawControlAt(source, offset);

        if (!redrawControl) {
          return undefined;
        }

        if (!activeDocument) {
          return null;
        }

        const target = await dependencies.findNetteRedrawControlSnippetTarget?.(
          activeDocument.path,
          redrawControl.name,
        );

        return target
          ? {
              kind: "nette.ajax-snippet",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
  ];

export const phpNetteLiteralDefinitionResolverContribution: PhpFrameworkLiteralDefinitionResolverContribution =
  {
    entries: NETTE_LITERAL_DEFINITION_RESOLVERS,
    providerId: "nette",
  };
