import { planExtractInterface } from "../domain/phpExtractInterface";
import { offsetToPosition } from "../domain/phpInsertionPoint";
import { zeroLengthPhpEditRange } from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export function phpExtractInterfaceCodeAction(
  source: string,
  range: PhpCodeActionRange,
  sourcePath: string | null,
): PhpCodeActionDescriptor | null {
  if (!sourcePath) {
    return null;
  }

  const plan = planExtractInterface(source, range.start, sourcePath);

  if (!plan) {
    return null;
  }

  const implementsPosition = offsetToPosition(
    source,
    plan.implementsEdit.offset,
  );

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(implementsPosition),
        text: plan.implementsEdit.text,
      },
    ],
    kind: "refactor.extract",
    newFile: {
      content: plan.interfaceText,
      path: plan.interfaceFilePath,
    },
    title: "Extract interface",
  };
}
