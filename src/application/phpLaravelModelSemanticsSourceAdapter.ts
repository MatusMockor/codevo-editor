import {
  phpLaravelModelSourcesForTableName,
  phpLaravelMorphMapEntriesFromSource,
} from "../domain/phpFrameworkLaravel";
import type { PhpModelSourceSemanticsAdapter } from "./phpModelSemanticsAdapter";

export function createPhpLaravelModelSemanticsSourceAdapter(): PhpModelSourceSemanticsAdapter {
  return {
    modelSourcesForTableName: (tableName, candidates) =>
      phpLaravelModelSourcesForTableName(tableName, candidates),
    morphMapEntriesFromSource: (source) =>
      phpLaravelMorphMapEntriesFromSource(source),
  };
}
