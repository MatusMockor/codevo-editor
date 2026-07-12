import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkBuilderMagicExpressionTypeAdapter,
  type PhpFrameworkBuilderMagicExpressionTypeAdapter,
} from "./phpFrameworkBuilderMagicExpressionTypeAdapter";
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
  type PhpLaravelBuilderMagicExpressionTypeAdapterOptions,
} from "./phpLaravelBuilderMagicExpressionTypeAdapter";
import { phpLaravelDatabaseExpressionTypeAdapter } from "./phpLaravelDatabaseExpressionTypeAdapter";
import { phpLaravelModelBuilderTransitionExpressionTypeAdapter } from "./phpLaravelModelBuilderTransitionExpressionTypeAdapter";
import { phpLaravelModelFluentExpressionTypeAdapter } from "./phpLaravelModelFluentExpressionTypeAdapter";
import { phpLaravelQueryCallbackVariableExpressionTypeAdapter } from "./phpLaravelQueryCallbackVariableExpressionTypeAdapter";
import {
  phpLaravelTerminalModelRecoveryExpressionTypeAdapter,
  type PhpLaravelTerminalModelRecoveryExpressionTypeAdapterOptions,
} from "./phpLaravelTerminalModelRecoveryExpressionTypeAdapter";

export interface PhpExpressionTypeAdapterBundle {
  builderMagicExpressionTypeAdapter: PhpFrameworkBuilderMagicExpressionTypeAdapter;
  databaseExpressionTypeAdapter: PhpFrameworkDatabaseExpressionTypeAdapter;
  modelBuilderTransitionExpressionTypeAdapter: PhpFrameworkModelBuilderTransitionExpressionTypeAdapter;
  modelFluentExpressionTypeAdapter: PhpFrameworkModelFluentExpressionTypeAdapter;
  queryCallbackVariableExpressionTypeAdapter: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter;
  terminalModelRecoveryExpressionTypeAdapter: PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter;
}

export interface PhpExpressionTypeAdapterDependencies
  extends PhpLaravelBuilderMagicExpressionTypeAdapterOptions,
    PhpLaravelTerminalModelRecoveryExpressionTypeAdapterOptions {}

interface PhpExpressionTypeAdapterContribution {
  providerId: string;
  createBundle(
    dependencies: PhpExpressionTypeAdapterDependencies,
  ): PhpExpressionTypeAdapterBundle;
}

const GENERIC_PHP_EXPRESSION_TYPE_ADAPTER_BUNDLE: PhpExpressionTypeAdapterBundle =
  {
    builderMagicExpressionTypeAdapter:
      genericPhpFrameworkBuilderMagicExpressionTypeAdapter,
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

const PHP_EXPRESSION_TYPE_ADAPTER_CONTRIBUTIONS: readonly PhpExpressionTypeAdapterContribution[] =
  [
    {
      providerId: "laravel",
      createBundle: (dependencies) => ({
        builderMagicExpressionTypeAdapter:
          phpLaravelBuilderMagicExpressionTypeAdapter(dependencies),
        databaseExpressionTypeAdapter: phpLaravelDatabaseExpressionTypeAdapter,
        modelBuilderTransitionExpressionTypeAdapter:
          phpLaravelModelBuilderTransitionExpressionTypeAdapter,
        modelFluentExpressionTypeAdapter:
          phpLaravelModelFluentExpressionTypeAdapter,
        queryCallbackVariableExpressionTypeAdapter:
          phpLaravelQueryCallbackVariableExpressionTypeAdapter,
        terminalModelRecoveryExpressionTypeAdapter:
          phpLaravelTerminalModelRecoveryExpressionTypeAdapter(dependencies),
      }),
    },
  ];

export function createPhpExpressionTypeAdapterBundle({
  frameworkRuntime,
  ...dependencies
}: PhpExpressionTypeAdapterDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}): PhpExpressionTypeAdapterBundle {
  const contribution = PHP_EXPRESSION_TYPE_ADAPTER_CONTRIBUTIONS.find(
    ({ providerId }) => frameworkRuntime.hasProvider(providerId),
  );

  if (!contribution) {
    return GENERIC_PHP_EXPRESSION_TYPE_ADAPTER_BUNDLE;
  }

  return contribution.createBundle(dependencies);
}
