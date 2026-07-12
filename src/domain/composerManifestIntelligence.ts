import type { ComposerPackageDescriptor } from "./workspace";
import {
  jsonManifestContextAt,
  type JsonManifestContext,
} from "./jsonManifestIntelligence";

export type ComposerDependencySection = "require" | "require-dev";

export type ComposerManifestContext = JsonManifestContext<ComposerDependencySection>;

const COMPOSER_DEPENDENCY_SECTIONS = [
  "require",
  "require-dev",
] as const satisfies readonly ComposerDependencySection[];

export function composerManifestContextAt(
  source: string,
  offset: number,
): ComposerManifestContext | null {
  return jsonManifestContextAt(source, offset, COMPOSER_DEPENDENCY_SECTIONS);
}

export function composerPackageHoverMarkdown(
  packageName: string,
  descriptor: ComposerPackageDescriptor | null | undefined,
): string {
  if (!descriptor) {
    return `**${packageName}**\n\nNot installed in the active workspace.`;
  }

  const version = descriptor.version ? `\`${descriptor.version}\`` : "Unknown";
  const installPath = descriptor.installPath
    ? `\`${descriptor.installPath}\``
    : "Not reported";

  return [
    `**${packageName}**`,
    `Installed version: ${version}`,
    `Development dependency: ${descriptor.dev ? "Yes" : "No"}`,
    `Install path: ${installPath}`,
  ].join("\n\n");
}
