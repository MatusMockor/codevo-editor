import type { EditorPosition } from "../domain/languageServerFeatures";
import type { NetteViewDataEntry } from "./netteViewDataEntries";
import type {
  LatteTemplateTypePropertySighting,
} from "./netteTemplateTypeDiscovery";

export interface LatteVariableTypeDependencies {
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
  resolveExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export interface LatteVariableResolutionContext {
  currentControlClassName(): Promise<string | null>;
  currentPresenterClassName(): Promise<string | null>;
  deps: LatteVariableTypeDependencies;
  isRequestedRootActive(): boolean;
  loadTemplateTypePropertySightings(
    source: string,
  ): Promise<LatteTemplateTypePropertySighting[]>;
  loadViewDataEntries(): Promise<NetteViewDataEntry[]>;
  maxTypeResolutionDepth: number;
  viewNames(): Promise<string[]>;
}
