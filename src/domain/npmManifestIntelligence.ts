import type { NpmPackageDescriptor } from "./workspace";
import {
  jsonManifestContextAt,
  type JsonManifestContext,
} from "./jsonManifestIntelligence";

export type NpmDependencySection =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export type NpmManifestContext = JsonManifestContext<NpmDependencySection>;

const NPM_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const satisfies readonly NpmDependencySection[];

export function npmManifestContextAt(
  source: string,
  offset: number,
): NpmManifestContext | null {
  return jsonManifestContextAt(source, offset, NPM_DEPENDENCY_SECTIONS);
}

export function npmPackageHoverMarkdown(
  packageName: string,
  descriptor: NpmPackageDescriptor,
): string {
  const installedVersion = descriptor.installedVersion
    ? `\`${descriptor.installedVersion}\``
    : "Not installed";

  return [
    `**${packageName}**`,
    `Declared range: \`${descriptor.declaredRange}\``,
    `Installed version: ${installedVersion}`,
    `Development dependency: ${descriptor.dev ? "Yes" : "No"}`,
  ].join("\n\n");
}
