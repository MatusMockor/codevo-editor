import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkSemanticAdapter,
  type PhpFrameworkSemanticAdapterContribution,
} from "./phpFrameworkSemanticAdapterRegistry";
import {
  genericPhpFrameworkBuilderMagicExpressionTypeAdapter,
  type PhpFrameworkBuilderMagicExpressionTypeAdapter,
} from "./phpFrameworkBuilderMagicExpressionTypeAdapter";
import {
  genericPhpFrameworkCollectionCallbackVariableExpressionTypeAdapter,
  type PhpFrameworkCollectionCallbackVariableExpressionTypeAdapter,
} from "./phpFrameworkCollectionCallbackVariableExpressionTypeAdapter";
import {
  genericPhpFrameworkDatabaseExpressionTypeAdapter,
  type PhpFrameworkDatabaseExpressionTypeAdapter,
} from "./phpFrameworkDatabaseExpressionTypeAdapter";
import {
  genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter,
  type PhpFrameworkModelBuilderTransitionExpressionTypeAdapter,
} from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapter";
import {
  genericPhpFrameworkModelFluentExpressionTypeAdapter,
  type PhpFrameworkModelFluentExpressionTypeAdapter,
} from "./phpFrameworkModelFluentExpressionTypeAdapter";
import {
  genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter,
  type PhpFrameworkQueryCallbackVariableExpressionTypeAdapter,
} from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapter";
import {
  genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter,
  type PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter,
} from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapter";
import {
  phpLaravelBuilderMagicExpressionTypeAdapter,
} from "./phpLaravelBuilderMagicExpressionTypeAdapter";
import { phpLaravelCollectionCallbackVariableExpressionTypeAdapter } from "./phpLaravelCollectionCallbackVariableExpressionTypeAdapter";
import { phpLaravelDatabaseExpressionTypeAdapter } from "./phpLaravelDatabaseExpressionTypeAdapter";
import { phpLaravelModelBuilderTransitionExpressionTypeAdapter } from "./phpLaravelModelBuilderTransitionExpressionTypeAdapter";
import { phpLaravelModelFluentExpressionTypeAdapter } from "./phpLaravelModelFluentExpressionTypeAdapter";
import { phpLaravelQueryCallbackVariableExpressionTypeAdapter } from "./phpLaravelQueryCallbackVariableExpressionTypeAdapter";
import {
  phpLaravelTerminalModelRecoveryExpressionTypeAdapter,
} from "./phpLaravelTerminalModelRecoveryExpressionTypeAdapter";

export interface PhpExpressionTypeAdapterBundle {
  builderMagicExpressionTypeAdapter: PhpFrameworkBuilderMagicExpressionTypeAdapter;
  collectionCallbackVariableExpressionTypeAdapter: PhpFrameworkCollectionCallbackVariableExpressionTypeAdapter;
  databaseExpressionTypeAdapter: PhpFrameworkDatabaseExpressionTypeAdapter;
  modelBuilderTransitionExpressionTypeAdapter: PhpFrameworkModelBuilderTransitionExpressionTypeAdapter;
  modelFluentExpressionTypeAdapter: PhpFrameworkModelFluentExpressionTypeAdapter;
  queryCallbackVariableExpressionTypeAdapter: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter;
  terminalModelRecoveryExpressionTypeAdapter: PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter;
}

export interface PhpExpressionTypeAdapterDependencies {
  phpClassHasDynamicBuilderFinder: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  phpClassHasNamedBuilderScope: (
    className: string,
    methodName: string,
  ) => Promise<boolean>;
  resolvePropertyOrRelationType: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
}

const GENERIC_PHP_EXPRESSION_TYPE_ADAPTER_BUNDLE: PhpExpressionTypeAdapterBundle =
  {
    builderMagicExpressionTypeAdapter:
      genericPhpFrameworkBuilderMagicExpressionTypeAdapter,
    collectionCallbackVariableExpressionTypeAdapter:
      genericPhpFrameworkCollectionCallbackVariableExpressionTypeAdapter,
    databaseExpressionTypeAdapter:
      genericPhpFrameworkDatabaseExpressionTypeAdapter,
    modelBuilderTransitionExpressionTypeAdapter:
      genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter,
    modelFluentExpressionTypeAdapter:
      genericPhpFrameworkModelFluentExpressionTypeAdapter,
    queryCallbackVariableExpressionTypeAdapter:
      genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter,
    terminalModelRecoveryExpressionTypeAdapter:
      genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter,
  };

function phpExpressionTypeAdapterContributions(
  dependencies: PhpExpressionTypeAdapterDependencies,
): readonly PhpFrameworkSemanticAdapterContribution<PhpExpressionTypeAdapterBundle>[] {
  return [
    {
      capability: "eloquentModelSemantics",
      id: "laravel-expression-type-adapters",
      priority: 100,
      createAdapter: () => ({
        builderMagicExpressionTypeAdapter:
          phpLaravelBuilderMagicExpressionTypeAdapter({
            phpClassHasLaravelDynamicWhere:
              dependencies.phpClassHasDynamicBuilderFinder,
            phpClassHasLaravelLocalScope:
              dependencies.phpClassHasNamedBuilderScope,
          }),
        collectionCallbackVariableExpressionTypeAdapter:
          phpLaravelCollectionCallbackVariableExpressionTypeAdapter,
        databaseExpressionTypeAdapter: phpLaravelDatabaseExpressionTypeAdapter,
        modelBuilderTransitionExpressionTypeAdapter:
          phpLaravelModelBuilderTransitionExpressionTypeAdapter,
        modelFluentExpressionTypeAdapter:
          phpLaravelModelFluentExpressionTypeAdapter,
        queryCallbackVariableExpressionTypeAdapter:
          phpLaravelQueryCallbackVariableExpressionTypeAdapter,
        terminalModelRecoveryExpressionTypeAdapter:
          phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
            resolvePropertyOrRelationType:
              dependencies.resolvePropertyOrRelationType,
          }),
      }),
    },
  ];
}

const PHP_EXPRESSION_TYPE_ADAPTER_CONTRIBUTIONS =
  phpExpressionTypeAdapterContributions;

export function createPhpExpressionTypeAdapterBundle({
  frameworkRuntime,
  ...dependencies
}: PhpExpressionTypeAdapterDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">;
}): PhpExpressionTypeAdapterBundle {
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    PHP_EXPRESSION_TYPE_ADAPTER_CONTRIBUTIONS(dependencies),
    GENERIC_PHP_EXPRESSION_TYPE_ADAPTER_BUNDLE,
  );
}
