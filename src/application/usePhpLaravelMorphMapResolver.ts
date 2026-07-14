import {
  usePhpFrameworkMorphMapResolver,
  type UsePhpFrameworkMorphMapResolverOptions,
} from "./usePhpFrameworkMorphMapResolver";

export type UsePhpLaravelMorphMapResolverOptions =
  UsePhpFrameworkMorphMapResolverOptions;

export interface PhpLaravelMorphMapResolver {
  resetPhpLaravelMorphMapModelTypeCache(): void;
  resolvePhpLaravelProjectMorphMapModelType(): Promise<string | null>;
}

export function usePhpLaravelMorphMapResolver(
  options: UsePhpLaravelMorphMapResolverOptions,
): PhpLaravelMorphMapResolver {
  const {
    resetPhpFrameworkMorphMapModelTypeCache,
    resolvePhpFrameworkProjectMorphMapModelType,
  } = usePhpFrameworkMorphMapResolver(options);

  return {
    resetPhpLaravelMorphMapModelTypeCache:
      resetPhpFrameworkMorphMapModelTypeCache,
    resolvePhpLaravelProjectMorphMapModelType:
      resolvePhpFrameworkProjectMorphMapModelType,
  };
}
