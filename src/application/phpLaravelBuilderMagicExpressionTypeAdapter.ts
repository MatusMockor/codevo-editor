import type { PhpFrameworkBuilderMagicExpressionTypeAdapter } from "./phpFrameworkBuilderMagicExpressionTypeAdapter";

export interface PhpLaravelBuilderMagicExpressionTypeAdapterOptions {
  phpClassHasLaravelDynamicWhere: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  phpClassHasLaravelLocalScope: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
}

const ELOQUENT_BUILDER_TYPE = "Illuminate\\Database\\Eloquent\\Builder";

export function phpLaravelBuilderMagicExpressionTypeAdapter({
  phpClassHasLaravelDynamicWhere,
  phpClassHasLaravelLocalScope,
}: PhpLaravelBuilderMagicExpressionTypeAdapterOptions): PhpFrameworkBuilderMagicExpressionTypeAdapter {
  return {
    methodCallType: async ({
      methodName,
      resolveBuilderModelType,
      resolveReceiverModelTypeCandidate,
    }) => {
      const builderModelType = await resolveBuilderModelType();

      if (builderModelType) {
        if (await phpClassHasLaravelLocalScope(builderModelType, methodName)) {
          return ELOQUENT_BUILDER_TYPE;
        }

        if (await phpClassHasLaravelDynamicWhere(builderModelType, methodName)) {
          return ELOQUENT_BUILDER_TYPE;
        }
      }

      const receiverModelType = await resolveReceiverModelTypeCandidate();

      if (!receiverModelType) {
        return null;
      }

      if (await phpClassHasLaravelLocalScope(receiverModelType, methodName)) {
        return ELOQUENT_BUILDER_TYPE;
      }

      return null;
    },
    staticCallType: async ({ className, methodName }) => {
      if (!className) {
        return null;
      }

      if (await phpClassHasLaravelLocalScope(className, methodName)) {
        return ELOQUENT_BUILDER_TYPE;
      }

      if (await phpClassHasLaravelDynamicWhere(className, methodName)) {
        return ELOQUENT_BUILDER_TYPE;
      }

      return null;
    },
  };
}
