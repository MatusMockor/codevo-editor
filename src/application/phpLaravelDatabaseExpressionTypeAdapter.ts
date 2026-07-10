import {
  isLaravelDatabaseConnectionType,
  isLaravelDatabaseQueryBuilderFactoryMethod,
  isLaravelDatabaseQueryBuilderFluentMethod,
  isLaravelDatabaseQueryBuilderType,
} from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkDatabaseExpressionTypeAdapter } from "./phpFrameworkDatabaseExpressionTypeAdapter";
import { laravelFacadeTargetClassName } from "./phpLaravelFacadeTargets";

const QUERY_BUILDER_TYPE = "Illuminate\\Database\\Query\\Builder";

export const phpLaravelDatabaseExpressionTypeAdapter: PhpFrameworkDatabaseExpressionTypeAdapter =
  {
    methodCallType: async ({ methodName, resolveReceiverType }) => {
      if (isLaravelDatabaseQueryBuilderFactoryMethod(methodName)) {
        const receiverType = await resolveReceiverType();

        if (receiverType && isLaravelDatabaseConnectionType(receiverType)) {
          return QUERY_BUILDER_TYPE;
        }
      }

      if (!isLaravelDatabaseQueryBuilderFluentMethod(methodName)) {
        return null;
      }

      const receiverType = await resolveReceiverType();

      if (!receiverType || !isLaravelDatabaseQueryBuilderType(receiverType)) {
        return null;
      }

      return QUERY_BUILDER_TYPE;
    },
    staticCallType: ({ className, methodName }) => {
      if (!className) {
        return null;
      }

      if (!isLaravelDatabaseQueryBuilderFactoryMethod(methodName)) {
        return null;
      }

      const targetClassName =
        laravelFacadeTargetClassName(className) ?? className;

      if (!isLaravelDatabaseConnectionType(targetClassName)) {
        return null;
      }

      return QUERY_BUILDER_TYPE;
    },
  };
