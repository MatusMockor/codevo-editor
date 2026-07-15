import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpNetteDatabaseDefinitionContextAt } from "../domain/phpNetteDatabaseDefinitionNavigation";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import type { PhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

export interface PhpNetteDatabaseDefinitionNavigationDependencies {
  databaseTypeResolver: PhpNetteDatabaseTypeResolver;
  isActive(): boolean;
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export interface PhpNetteDatabaseDefinitionNavigation {
  provideDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function createPhpNetteDatabaseDefinitionNavigation({
  databaseTypeResolver,
  isActive,
  openPhpClassTarget,
  resolvePhpExpressionType,
}: PhpNetteDatabaseDefinitionNavigationDependencies): PhpNetteDatabaseDefinitionNavigation {
  return {
    async provideDefinition(source, offset, request) {
      if (!isActive() || !canNavigate(request)) {
        return false;
      }

      const context = phpNetteDatabaseDefinitionContextAt(source, offset);

      if (!context) {
        return false;
      }

      const receiverType = await resolvePhpExpressionType(
        source,
        context.position,
        context.receiverExpression,
      );

      if (!isActive() || !canNavigate(request)) {
        return false;
      }

      let targetType = receiverType
        ? await databaseTypeResolver.resolveTableType(
            receiverType,
            context.kind,
            context.tableName,
          )
        : null;

      if (!isActive() || !canNavigate(request)) {
        return false;
      }

      if (!targetType && context.receiverPhpDocType) {
        const refinedReceiverType = await resolvePhpExpressionType(
          source,
          context.position,
          `new ${context.receiverPhpDocType}()`,
        );

        if (!isActive() || !canNavigate(request)) {
          return false;
        }

        if (refinedReceiverType && refinedReceiverType !== receiverType) {
          targetType = await databaseTypeResolver.resolveTableType(
            refinedReceiverType,
            context.kind,
            context.tableName,
          );
        }
      }

      if (!targetType || !isActive() || !canNavigate(request)) {
        return false;
      }

      const typeSegments = targetType.split("\\");
      const label = typeSegments[typeSegments.length - 1] || targetType;
      const opened = request
        ? await openPhpClassTarget(targetType, label, request)
        : await openPhpClassTarget(targetType, label);

      return isActive() && canNavigate(request) && opened;
    },
  };
}
