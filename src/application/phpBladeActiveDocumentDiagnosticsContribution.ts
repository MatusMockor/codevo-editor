import { bladeLaravelReferenceDiagnostics } from "../domain/laravelDiagnostics";
import type { PhpFrameworkActiveDocumentDiagnosticsContribution } from "./phpFrameworkActiveDocumentDiagnosticsContributions";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export function createPhpBladeViewReferenceDiagnosticsContribution(
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"],
): PhpFrameworkActiveDocumentDiagnosticsContribution {
  return {
    id: "bladeViewReferences",
    supports: (descriptor) => descriptor.kind === "bladeViewReferences",
    provideDiagnostics: async ({ document }) => {
      const viewTargets = await collectViewTargets();

      return bladeLaravelReferenceDiagnostics(document.content, {
        viewNames: viewTargets.map((target) => target.name),
      });
    },
  };
}
