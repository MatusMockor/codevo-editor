export interface PhpFrameworkFileChangeInvalidationDescriptorLike {
  readonly kind: string;
}

export interface PhpFrameworkFileChangeInvalidationRequest {
  readonly rootPath: string;
  readonly path: string;
}

export interface PhpFrameworkFileChangeInvalidationContribution {
  readonly id: string;
  readonly priority?: number;
  supports(
    descriptor: PhpFrameworkFileChangeInvalidationDescriptorLike,
  ): boolean;
  invalidate(request: PhpFrameworkFileChangeInvalidationRequest): void;
}
