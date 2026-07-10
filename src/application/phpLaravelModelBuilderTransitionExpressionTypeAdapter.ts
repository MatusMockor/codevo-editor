import {
  isLaravelCollectionFluentMethod,
  isLaravelCollectionTerminalModelMethod,
  isLaravelEloquentBuilderCollectionMethod,
  isLaravelEloquentBuilderFluentMethod,
  isLaravelEloquentBuilderTerminalModelMethod,
  isLaravelEloquentModelBuilderFactoryMethod,
  isLaravelEloquentStaticBuilderMethod,
} from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkModelBuilderTransitionExpressionTypeAdapter } from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapter";

const ELOQUENT_BUILDER_TYPE = "Illuminate\\Database\\Eloquent\\Builder";
const ELOQUENT_COLLECTION_TYPE =
  "Illuminate\\Database\\Eloquent\\Collection";

export const phpLaravelModelBuilderTransitionExpressionTypeAdapter: PhpFrameworkModelBuilderTransitionExpressionTypeAdapter =
  {
    methodCallType: async ({
      methodName,
      resolveCollectionTerminalModelType,
      resolveModelFactoryModelType,
      resolveBuilderTerminalModelType,
      resolveBuilderModelType,
      resolveCollectionModelType,
    }) => {
      if (isLaravelCollectionTerminalModelMethod(methodName)) {
        const modelType = await resolveCollectionTerminalModelType();

        if (modelType) {
          return modelType;
        }
      }

      if (isLaravelEloquentModelBuilderFactoryMethod(methodName)) {
        const modelType = await resolveModelFactoryModelType();

        if (modelType) {
          return ELOQUENT_BUILDER_TYPE;
        }
      }

      if (isLaravelEloquentBuilderTerminalModelMethod(methodName)) {
        const modelType = await resolveBuilderTerminalModelType();

        if (modelType) {
          return modelType;
        }
      }

      if (isLaravelEloquentBuilderCollectionMethod(methodName)) {
        const modelType = await resolveBuilderModelType();

        if (modelType) {
          return ELOQUENT_COLLECTION_TYPE;
        }
      }

      if (isLaravelCollectionFluentMethod(methodName)) {
        const modelType = await resolveCollectionModelType();

        if (modelType) {
          return ELOQUENT_COLLECTION_TYPE;
        }
      }

      if (isLaravelEloquentBuilderFluentMethod(methodName)) {
        const modelType = await resolveBuilderModelType();

        if (modelType) {
          return ELOQUENT_BUILDER_TYPE;
        }
      }

      return null;
    },
    staticCallType: async ({ className, methodName }) => {
      if (!className) {
        return null;
      }

      if (isLaravelEloquentBuilderTerminalModelMethod(methodName)) {
        return className;
      }

      if (isLaravelEloquentStaticBuilderMethod(methodName)) {
        return ELOQUENT_BUILDER_TYPE;
      }

      return null;
    },
  };
