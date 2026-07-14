import {
  BLADE_DIRECTIVES,
  bladeComponentNavigationCandidateRelativePaths,
  bladeReferenceCandidateWorkspacePaths,
  detectBladeComponentAttributeCompletionAt,
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
  isInsideBladeComment,
} from "../domain/bladeNavigation";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { BladeFrameworkCapabilities } from "./bladeIntelligenceContracts";

export function createBladeFrameworkCapabilities(
  getProviders: () => readonly PhpFrameworkProvider[],
): BladeFrameworkCapabilities {
  const activeBlade = () =>
    getProviders().find((provider) => provider.blade !== undefined)?.blade;

  return {
    componentAttributeCompletionAt: (source, offset) => {
      const blade = activeBlade();

      if (!blade) {
        return detectBladeComponentAttributeCompletionAt(source, offset);
      }

      return blade.componentAttributeCompletionAt?.({ offset, source }) ?? null;
    },
    componentCompletionAt: (source, offset) => {
      const blade = activeBlade();

      if (!blade) {
        return detectBladeComponentCompletionAt(source, offset);
      }

      return blade.componentCompletionAt?.({ offset, source }) ?? null;
    },
    componentNavigationCandidateRelativePaths: (name) => {
      const blade = activeBlade();

      if (!blade) {
        return bladeComponentNavigationCandidateRelativePaths(name);
      }

      return blade.componentNavigationCandidateRelativePaths?.({ name }) ?? [];
    },
    directiveCompletionAt: (source, offset) => {
      const blade = activeBlade();

      if (!blade) {
        return detectBladeDirectiveCompletionAt(source, offset);
      }

      return blade.directiveCompletionAt?.({ offset, source }) ?? null;
    },
    get directiveNames() {
      const blade = activeBlade();

      if (!blade) {
        return BLADE_DIRECTIVES;
      }

      return blade.directiveNames ?? [];
    },
    isInsideComment: (source, offset) => {
      const blade = activeBlade();

      if (!blade) {
        return isInsideBladeComment(source, offset);
      }

      return blade.isInsideComment?.({ offset, source }) === true;
    },
    referenceAt: (source, offset) => {
      const blade = activeBlade();

      if (!blade) {
        return detectBladeReferenceAt(source, offset);
      }

      return blade.referenceAt?.({ offset, source }) ?? null;
    },
    referenceCandidateWorkspacePaths: (workspaceRoot, reference) => {
      const blade = activeBlade();

      if (!blade) {
        return bladeReferenceCandidateWorkspacePaths(workspaceRoot, reference);
      }

      return (
        blade.referenceCandidateWorkspacePaths?.({ reference, workspaceRoot }) ??
        []
      );
    },
  };
}
