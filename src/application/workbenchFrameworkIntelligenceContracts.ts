import type { EditorPosition } from "../domain/languageServerFeatures";
import type { phpFrameworkScopedStringCompletionContextAt } from "../domain/phpFrameworkLiteralDispatch";
import type {
  BladeIntelligence,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";
import type {
  LatteIntelligence,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import type {
  NeonIntelligence,
  NeonIntelligenceDependencies,
} from "./neonIntelligenceContracts";

type FrameworkStringCompletionProviders = Parameters<
  typeof phpFrameworkScopedStringCompletionContextAt
>[2];

export interface WorkbenchFrameworkIntelligenceDependencies {
  activePhpFrameworkProviders: FrameworkStringCompletionProviders;
  blade: BladeIntelligenceDependencies;
  latte: LatteIntelligenceDependencies;
  neon: NeonIntelligenceDependencies;
}

export interface WorkbenchFrameworkIntelligence
  extends BladeIntelligence,
    LatteIntelligence,
    NeonIntelligence {
  isPhpFrameworkStringCompletionContext(
    source: string,
    position: EditorPosition,
  ): boolean;
}
