import {
  genericPhpFrameworkBuilderMagicExpressionTypeAdapter,
  type PhpFrameworkBuilderMagicExpressionTypeAdapter,
} from "./phpFrameworkBuilderMagicExpressionTypeAdapter";
import {
  phpLaravelBuilderMagicExpressionTypeAdapter,
  type PhpLaravelBuilderMagicExpressionTypeAdapterOptions,
} from "./phpLaravelBuilderMagicExpressionTypeAdapter";

export function phpFrameworkBuilderMagicExpressionTypeAdapters(
  isLaravelFrameworkActive: boolean,
  options: PhpLaravelBuilderMagicExpressionTypeAdapterOptions,
): PhpFrameworkBuilderMagicExpressionTypeAdapter {
  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkBuilderMagicExpressionTypeAdapter;
  }

  return phpLaravelBuilderMagicExpressionTypeAdapter(options);
}
