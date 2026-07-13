import {
  detectLatteReferenceAt,
  type LatteReference,
} from "./latteNavigation";
import {
  resolveLatteTemplateCandidatePaths,
} from "./nettePathResolution";

export interface MissingLatteTemplateReference {
  name: string;
  nameEnd: number;
  nameStart: number;
  relativePath: string;
}

export function missingLatteTemplateReferenceAt(
  source: string,
  offset: number,
  currentTemplateRelativePath: string,
  templateRelativePaths: readonly string[],
): MissingLatteTemplateReference | null {
  const reference = detectLatteReferenceAt(source, offset);

  if (!isCreatableTemplateReference(reference)) {
    return null;
  }

  const candidates = resolveLatteTemplateCandidatePaths(
    reference.name,
    currentTemplateRelativePath,
  );

  if (candidates.length === 0) {
    return null;
  }

  const indexedTemplates = new Set(templateRelativePaths);
  const existingCandidate = candidates.find((candidate) =>
    indexedTemplates.has(candidate),
  );

  if (existingCandidate) {
    return null;
  }

  return {
    name: reference.name,
    nameEnd: reference.nameEnd,
    nameStart: reference.nameStart,
    relativePath: candidates[0] ?? "",
  };
}

function isCreatableTemplateReference(
  reference: LatteReference | null,
): reference is LatteReference & { kind: "template" } {
  if (!reference || reference.kind !== "template") {
    return false;
  }

  if (reference.tag === "layout" && reference.name.trim() === "none") {
    return false;
  }

  return true;
}
