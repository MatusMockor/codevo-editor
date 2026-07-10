import { isLaravelEloquentModelFluentMethod } from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkModelFluentExpressionTypeAdapter } from "./phpFrameworkModelFluentExpressionTypeAdapter";

export const phpLaravelModelFluentExpressionTypeAdapter: PhpFrameworkModelFluentExpressionTypeAdapter =
  {
    receiverMethodCallType: ({ methodName, receiverType }) => {
      if (!receiverType) {
        return null;
      }

      if (!isLaravelEloquentModelFluentMethod(methodName)) {
        return null;
      }

      return receiverType;
    },
  };
