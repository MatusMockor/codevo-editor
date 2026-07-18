import { isPhpChangeSignatureTarget } from "../domain/phpChangeSignature";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

export function phpChangeSignatureCodeAction(options: {
  offset: number;
  path: string | null;
  rootPath: string;
  source: string;
}): PhpCodeActionDescriptor | null {
  if (
    !options.path ||
    !isPhpChangeSignatureTarget(options.source, options.offset)
  ) {
    return null;
  }

  return {
    edits: [],
    interaction: {
      kind: "change-signature",
      offset: options.offset,
      path: options.path,
      rootPath: options.rootPath,
    },
    kind: "refactor.rewrite",
    title: "Change signature…",
  };
}
