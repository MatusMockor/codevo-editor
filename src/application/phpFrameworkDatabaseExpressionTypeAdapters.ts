import {
  genericPhpFrameworkDatabaseExpressionTypeAdapter,
  type PhpFrameworkDatabaseExpressionTypeAdapter,
} from "./phpFrameworkDatabaseExpressionTypeAdapter";
import { phpLaravelDatabaseExpressionTypeAdapter } from "./phpLaravelDatabaseExpressionTypeAdapter";

export function createPhpFrameworkDatabaseExpressionTypeAdapters(
  isLaravelFrameworkActive: boolean,
): PhpFrameworkDatabaseExpressionTypeAdapter {
  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkDatabaseExpressionTypeAdapter;
  }

  return phpLaravelDatabaseExpressionTypeAdapter;
}
