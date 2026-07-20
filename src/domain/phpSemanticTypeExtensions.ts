export interface PhpSemanticSourceContext {
  readonly workspaceSources?: readonly string[];
}

interface PhpSemanticTypeRequest {
  readonly source: string;
  readonly sourceContext?: PhpSemanticSourceContext;
}

export interface PhpContainerExpressionTypeRequest extends PhpSemanticTypeRequest {
  readonly expression: string;
}

export interface PhpPropertyTypeRequest extends PhpSemanticTypeRequest {
  readonly propertyName: string;
  readonly receiverType: string | null;
}

export interface PhpMethodCallReturnTypeRequest extends PhpSemanticTypeRequest {
  readonly callExpression: string | null;
  readonly methodName: string;
  readonly receiverExpression: string | null;
  readonly receiverType: string | null;
}

export interface PhpSameSourceMethodReturnFallbackRequest {
  readonly methodName: string;
}

/**
 * Synchronous, side-effect-free semantic hot-path extension.
 *
 * It intentionally stays separate from asynchronous intelligence
 * contributions: it has no workspace lifecycle, ownership, or abort contract.
 */
export interface PhpSemanticTypeExtension {
  containerExpressionType?(
    request: PhpContainerExpressionTypeRequest,
  ): string | null;
  methodCallReturnType?(request: PhpMethodCallReturnTypeRequest): string | null;
  propertyType?(request: PhpPropertyTypeRequest): string | null;
  suppressSameSourceMethodReturnFallback?(
    request: PhpSameSourceMethodReturnFallbackRequest,
  ): boolean;
}

export function phpContainerExpressionTypeFromExtensions(
  extensions: readonly PhpSemanticTypeExtension[],
  request: PhpContainerExpressionTypeRequest,
): string | null {
  for (const extension of extensions) {
    const type = extension.containerExpressionType?.(request);

    if (type) {
      return type;
    }
  }

  return null;
}

export function phpMethodCallReturnTypeFromExtensions(
  extensions: readonly PhpSemanticTypeExtension[],
  request: PhpMethodCallReturnTypeRequest,
): string | null {
  for (const extension of extensions) {
    const type = extension.methodCallReturnType?.(request);

    if (type) {
      return type;
    }
  }

  return null;
}

export function phpPropertyTypeFromExtensions(
  extensions: readonly PhpSemanticTypeExtension[],
  request: PhpPropertyTypeRequest,
): string | null {
  for (const extension of extensions) {
    const type = extension.propertyType?.(request);

    if (type) {
      return type;
    }
  }

  return null;
}

export function phpSuppressesSameSourceMethodReturnFallback(
  extensions: readonly PhpSemanticTypeExtension[],
  request: PhpSameSourceMethodReturnFallbackRequest,
): boolean {
  return extensions.some(
    (extension) =>
      extension.suppressSameSourceMethodReturnFallback?.(request) === true,
  );
}
