import { planAddParameter } from "../domain/phpAddParameter";
import {
  planAddParameterType,
  planAddReturnType,
} from "../domain/phpAddTypeHint";
import { planExtractMethod } from "../domain/phpExtractMethod";
import { planExtractVariable } from "../domain/phpExtractVariable";
import { planInlineVariable } from "../domain/phpInlineVariable";
import {
  planIntroduceConstant,
  planIntroduceField,
} from "../domain/phpIntroduceMember";
import {
  phpInsertionEdit,
  phpReplacementEdit,
} from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
} from "./phpCodeActionTypes";

export function phpExtractVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  if (range.start >= range.end) {
    return null;
  }

  const plan = planExtractVariable(source, range.start, range.end);

  if (!plan) {
    return null;
  }

  return {
    edits: [
      phpInsertionEdit(source, plan.declarationOffset, plan.declarationText),
      phpReplacementEdit(
        source,
        plan.replaceStart,
        plan.replaceEnd,
        plan.replacementText,
      ),
    ],
    kind: "refactor.extract",
    title: "Extract variable",
  };
}

export function phpExtractMethodCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  if (range.start >= range.end) {
    return null;
  }

  const plan = planExtractMethod(source, range.start, range.end);

  if (!plan) {
    return null;
  }

  return {
    edits: [
      phpReplacementEdit(
        source,
        plan.replaceStart,
        plan.replaceEnd,
        plan.replacementText,
      ),
      phpInsertionEdit(source, plan.methodInsertionOffset, plan.methodText),
    ],
    kind: "refactor.extract",
    title: "Extract method",
  };
}

export function phpAddParameterCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planAddParameter(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: [phpInsertionEdit(source, plan.insertOffset, plan.insertText)],
    kind: "refactor.rewrite",
    title: "Add parameter",
  };
}

export function phpAddReturnTypeCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planAddReturnType(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: [phpInsertionEdit(source, plan.insertOffset, plan.insertText)],
    kind: "refactor.rewrite",
    title: "Add return type",
  };
}

export function phpAddParameterTypeCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planAddParameterType(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: [phpInsertionEdit(source, plan.insertOffset, plan.insertText)],
    kind: "refactor.rewrite",
    title: "Add type hint",
  };
}

export function phpInlineVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planInlineVariable(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: plan.edits.map((edit) =>
      phpReplacementEdit(source, edit.start, edit.end, edit.text),
    ),
    kind: "refactor.inline",
    title: "Inline variable",
  };
}

export function phpIntroduceConstantCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planIntroduceConstant(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: phpIntroduceMemberEdits(source, plan),
    kind: "refactor.extract",
    title: "Introduce constant",
  };
}

export function phpIntroduceFieldCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planIntroduceField(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: phpIntroduceMemberEdits(source, plan),
    kind: "refactor.extract",
    title: "Introduce field",
  };
}

function phpIntroduceMemberEdits(
  source: string,
  plan: {
    declarationOffset: number;
    declarationText: string;
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
  },
): PhpCodeActionTextEdit[] {
  return [
    phpInsertionEdit(source, plan.declarationOffset, plan.declarationText),
    phpReplacementEdit(
      source,
      plan.replaceStart,
      plan.replaceEnd,
      plan.replacementText,
    ),
  ];
}
