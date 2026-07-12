export interface PhpLaravelLivewireTarget {
  relativeFilePaths: string[];
}

export function isValidLaravelLivewireComponentName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(
    name,
  );
}

export function phpLaravelLivewireStudlySegment(segment: string): string {
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function phpLaravelLivewireCandidateRelativePaths(
  name: string,
): string[] {
  if (!isValidLaravelLivewireComponentName(name)) {
    return [];
  }

  const classPath = name
    .split(".")
    .map(phpLaravelLivewireStudlySegment)
    .join("/");

  return [
    `app/Livewire/${classPath}.php`,
    `app/Http/Livewire/${classPath}.php`,
  ];
}

export function resolveLaravelLivewireTarget(
  literal: string,
): PhpLaravelLivewireTarget | null {
  const relativeFilePaths = phpLaravelLivewireCandidateRelativePaths(literal);

  if (relativeFilePaths.length === 0) {
    return null;
  }

  return { relativeFilePaths };
}
