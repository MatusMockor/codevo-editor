import type { EditorPosition } from "./languageServerFeatures";

export interface PhpFrameworkPropertyTypeContext {
  propertyName: string;
  receiverType: string | null;
  source: string;
}

export interface PhpFrameworkQueryCallbackContext {
  methodName: string;
  modelClassName: string | null;
  morphTypeClassNames?: string[];
  previousRelationNames?: string[];
  receiverExpression: string | null;
  relationName: string | null;
}

export interface PhpFrameworkQueryCallbackVariableContext {
  position: EditorPosition;
  source: string;
  variableName: string;
}

export interface PhpFrameworkSourceContext {
  workspaceSources?: readonly string[];
}

export interface PhpFrameworkMethodCallReturnTypeContext {
  callExpression: string | null;
  methodName: string;
  receiverExpression: string | null;
  receiverType: string | null;
  sourceContext?: PhpFrameworkSourceContext;
  source: string;
}

export interface PhpFrameworkSameSourceMethodReturnFallbackContext {
  methodName: string;
}

export interface PhpFrameworkContainerExpressionContext {
  expression: string;
}

export interface PhpFrameworkContainerBinding {
  abstractClassName: string;
  concreteClassName: string;
}

export interface PhpFrameworkContainerBindingsContext {
  source: string;
}

export interface PhpFrameworkContainerConcreteClassNamesContext {
  source: string;
}

export interface PhpFrameworkContainerAutowiredCandidate {
  autowiredTypes: readonly string[] | null;
  producedTypeSource:
    | {
        className: string;
        kind: "class";
      }
    | {
        declaringClassName: string;
        kind: "factoryMethod";
        methodName: string;
        staticOnly: boolean;
      };
  source: string;
}

export interface PhpFrameworkContainerAutowiredCandidatesContext {
  sources: readonly string[];
}

export interface PhpFrameworkContainerBindingPathContext {
  path: string;
}

export interface PhpFrameworkSemanticCapabilities {
  queryCallbackContextForVariable?: (
    context: PhpFrameworkQueryCallbackVariableContext,
  ) => PhpFrameworkQueryCallbackContext | null;
  propertyTypeFromSource?: (
    context: PhpFrameworkPropertyTypeContext,
  ) => string | null;
  methodCallReturnTypeFromSource?: (
    context: PhpFrameworkMethodCallReturnTypeContext,
  ) => string | null;
  suppressesSameSourceMethodReturnFallback?: (
    context: PhpFrameworkSameSourceMethodReturnFallbackContext,
  ) => boolean;
  containerExpressionClassName?: (
    context: PhpFrameworkContainerExpressionContext,
  ) => string | null;
  containerBindingsFromSource?: (
    context: PhpFrameworkContainerBindingsContext,
  ) => PhpFrameworkContainerBinding[];
  containerConcreteClassNamesFromSource?: (
    context: PhpFrameworkContainerConcreteClassNamesContext,
  ) => string[];
  containerAutowiredCandidatesFromSources?: (
    context: PhpFrameworkContainerAutowiredCandidatesContext,
  ) => PhpFrameworkContainerAutowiredCandidate[];
  isContainerBindingCandidatePath?: (
    context: PhpFrameworkContainerBindingPathContext,
  ) => boolean;
  supportsContainerBindingTextSearch?: true;
  supportsEloquentModelSemantics?: true;
  supportsNetteDatabaseSemantics?: true;
}

export interface PhpFrameworkSemanticProvider {
  readonly id: string;
  readonly semantics?: PhpFrameworkSemanticCapabilities;
}
