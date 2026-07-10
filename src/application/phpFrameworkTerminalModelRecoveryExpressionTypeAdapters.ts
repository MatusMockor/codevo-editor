import {
  genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter,
  type PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter,
} from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapter";
import {
  phpLaravelTerminalModelRecoveryExpressionTypeAdapter,
  type PhpLaravelTerminalModelRecoveryExpressionTypeAdapterOptions,
} from "./phpLaravelTerminalModelRecoveryExpressionTypeAdapter";

export function createPhpFrameworkTerminalModelRecoveryExpressionTypeAdapters(
  isLaravelFrameworkActive: boolean,
  options: PhpLaravelTerminalModelRecoveryExpressionTypeAdapterOptions,
): PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter {
  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter;
  }

  return phpLaravelTerminalModelRecoveryExpressionTypeAdapter(options);
}
