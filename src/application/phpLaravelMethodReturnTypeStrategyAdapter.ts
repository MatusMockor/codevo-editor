import type { EditorPosition } from "../domain/languageServerFeatures";
import { isLaravelEloquentBuilderTerminalModelMethod } from "../domain/phpFrameworkLaravel";
import { phpDeclaredTypeCandidate } from "../domain/phpTypeAnalysis";
import type { PhpMethodReturnTypeStrategy } from "./phpMethodReturnTypeStrategy";
import { laravelFacadeTargetClassName } from "./phpLaravelFacadeTargets";

export interface PhpLaravelMethodReturnTypeStrategyAdapterDependencies {
  resolvePhpEloquentBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpLaravelProjectMorphMapModelType(): Promise<string | null>;
}

export function createPhpLaravelMethodReturnTypeStrategyAdapter({
  resolvePhpEloquentBuilderModelType,
  resolvePhpLaravelProjectMorphMapModelType,
}: PhpLaravelMethodReturnTypeStrategyAdapterDependencies): PhpMethodReturnTypeStrategy {
  return {
    async declaredReturnTypeOverride({ methodReturnExpressions, returnType }) {
      if (
        !isLaravelMorphToReturnTypeName(returnType) ||
        !methodReturnExpressions.some(isLaravelMorphToFactoryExpression)
      ) {
        return null;
      }

      return laravelMorphToReturnType(
        await resolvePhpLaravelProjectMorphMapModelType(),
      );
    },
    facadeTargetClassName: laravelFacadeTargetClassName,
    async methodCallReturnType({
      methodName,
      ownerSource,
      receiverExpression,
      receiverType,
    }) {
      if (methodName.toLowerCase() === "morphto" && receiverType) {
        return laravelMorphToReturnType(
          await resolvePhpLaravelProjectMorphMapModelType(),
        );
      }

      if (isLaravelEloquentBuilderTerminalModelMethod(methodName)) {
        return resolvePhpEloquentBuilderModelType(
          ownerSource,
          {
            column: 1,
            lineNumber: 1,
          },
          receiverExpression,
        );
      }

      return null;
    },
    staticCallReturnType({ className, methodName }) {
      if (
        !className ||
        !isLaravelEloquentBuilderTerminalModelMethod(methodName)
      ) {
        return null;
      }

      return className;
    },
  };
}

function laravelMorphToReturnType(modelType: string | null): string | null {
  return modelType
    ? `Illuminate\\Database\\Eloquent\\Relations\\MorphTo<${modelType}>`
    : null;
}

function isLaravelMorphToReturnTypeName(returnType: string | null): boolean {
  const typeName = phpDeclaredTypeCandidate(returnType ?? "") ?? returnType ?? "";
  const normalizedTypeName = typeName
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();

  return (
    normalizedTypeName === "morphto" ||
    normalizedTypeName?.endsWith("\\morphto") === true
  );
}

function isLaravelMorphToFactoryExpression(expression: string): boolean {
  return /\$(?:this|[A-Za-z_][A-Za-z0-9_]*)\??->morphTo\s*\(/i.test(
    expression,
  );
}
