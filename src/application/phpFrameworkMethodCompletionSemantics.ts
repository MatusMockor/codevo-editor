import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";

export interface PhpFrameworkMethodCompletionSemanticsAdapter {
  facadeTargetClassName(className: string): string | null;
  receiverCompletionGroups(
    context: PhpReceiverMethodCompletionSemanticsContext,
  ): Promise<PhpMethodCompletionGroups>;
  staticCompletionGroups(
    context: PhpStaticMethodCompletionSemanticsContext,
  ): Promise<PhpMethodCompletionGroups>;
}

export interface PhpReceiverMethodCompletionSemanticsContext {
  collectPhpMethodsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  position: EditorPosition;
  receiverExpression: string;
  receiverMethods: PhpMethodCompletion[];
  resolvedReceiverType: string | null;
  source: string;
}

export interface PhpStaticMethodCompletionSemanticsContext {
  className: string;
  methods: PhpMethodCompletion[];
  source: string;
}

export interface PhpMethodCompletionGroups {
  baseMethods: PhpMethodCompletion[];
  dynamicWhereMethods: PhpMethodCompletion[];
  localScopeMethods: PhpMethodCompletion[];
}

export const genericPhpMethodCompletionSemantics: PhpFrameworkMethodCompletionSemanticsAdapter =
  {
    facadeTargetClassName() {
      return null;
    },
    async receiverCompletionGroups({ receiverMethods }) {
      return {
        baseMethods: receiverMethods.filter(
          (method) => method.kind !== "scope",
        ),
        dynamicWhereMethods: [],
        localScopeMethods: [],
      };
    },
    async staticCompletionGroups({ methods }) {
      return {
        baseMethods: methods.filter((method) => method.isStatic),
        dynamicWhereMethods: [],
        localScopeMethods: [],
      };
    },
  };
