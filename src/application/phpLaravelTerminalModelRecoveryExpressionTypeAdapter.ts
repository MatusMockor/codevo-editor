import {
  isLaravelCollectionFluentMethod,
  isLaravelEloquentBuilderCollectionMethod,
} from "../domain/phpFrameworkLaravel";
import {
  phpMethodCallExpression,
  phpPropertyAccessExpression,
} from "../domain/phpSemanticEngine";
import type { PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter } from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapter";

export interface PhpLaravelTerminalModelRecoveryExpressionTypeAdapterOptions {
  resolvePropertyOrRelationType: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
}

export function phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
  resolvePropertyOrRelationType,
}: PhpLaravelTerminalModelRecoveryExpressionTypeAdapterOptions): PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter {
  return {
    collectionTerminalModelType: async ({
      receiverExpression,
      resolveCollectionModelType,
      resolveExpressionType,
    }) => {
      const propertyAccess = phpPropertyAccessExpression(receiverExpression);

      if (propertyAccess) {
        const ownerType = await resolveExpressionType(
          propertyAccess.receiverExpression,
        );
        const relationModelType = ownerType
          ? await resolvePropertyOrRelationType(
              ownerType,
              propertyAccess.propertyName,
              true,
            )
          : null;

        if (relationModelType) {
          return relationModelType;
        }
      }

      return resolveCollectionModelType();
    },
    builderTerminalModelType: async ({
      receiverExpression,
      resolveBuilderModelType,
      resolveExpressionType,
    }) => {
      let relationExpression = receiverExpression;
      let relationCall = phpMethodCallExpression(relationExpression);

      while (
        relationCall &&
        (isLaravelEloquentBuilderCollectionMethod(relationCall.methodName) ||
          isLaravelCollectionFluentMethod(relationCall.methodName))
      ) {
        relationExpression = relationCall.receiverExpression;
        relationCall = phpMethodCallExpression(relationExpression);
      }

      const propertyAccess = phpPropertyAccessExpression(relationExpression);
      const ownerExpression =
        relationCall?.receiverExpression ?? propertyAccess?.receiverExpression;
      const relationMemberName =
        relationCall?.methodName ?? propertyAccess?.propertyName;

      if (ownerExpression && relationMemberName) {
        const ownerType = await resolveExpressionType(ownerExpression);
        const relationModelType = ownerType
          ? await resolvePropertyOrRelationType(
              ownerType,
              relationMemberName,
              true,
            )
          : null;

        if (relationModelType) {
          return relationModelType;
        }
      }

      return resolveBuilderModelType();
    },
  };
}
