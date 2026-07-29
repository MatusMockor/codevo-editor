import type * as Monaco from "monaco-editor";
import {
  pathFromLanguageServerUri,
  type LanguageServerLocation,
} from "../domain/languageServerFeatures";
import { toWorkspaceMonacoUri } from "./phpMonacoDocumentContext";
import { javaScriptTypeScriptPathIsInWorkspaceRoot } from "./javascriptTypescriptWorkspaceEditScope";
import { monacoModelRegistry } from "./monacoModelRegistry";
import {
  languageServerUriToMonacoUri,
  toMonacoPositionLike,
  type JavaScriptTypeScriptPreparedNavigationTarget,
} from "./javascriptTypescriptMonacoProviderRegistration";

export function toJavaScriptTypeScriptShowReferencesArguments(
  monaco: typeof Monaco,
  args: unknown[],
  rootPath?: string,
): unknown[] {
  if (args.length < 3) {
    return args;
  }
  const [uri, position, locations, ...rest] = args;
  return [
    typeof uri === "string" ? languageServerUriToMonacoUri(monaco, rootPath, uri) : uri,
    toMonacoPositionLike(position),
    Array.isArray(locations)
      ? toJavaScriptTypeScriptMonacoLocations(
          monaco,
          locations as LanguageServerLocation[],
          rootPath,
        )
      : locations,
    ...rest,
  ];
}

export function toJavaScriptTypeScriptMonacoLocations(
  monaco: typeof Monaco,
  locations: readonly LanguageServerLocation[],
  rootPath?: string,
  includeExternal = false,
  preparedResources: ReadonlyMap<string, Monaco.Uri> = new Map(),
): Monaco.languages.Location[] {
  return locations.flatMap((location) => {
    const path = pathFromLanguageServerUri(location.uri);
    if (!path) {
      return [];
    }

    const isInRoot = !rootPath || javaScriptTypeScriptPathIsInWorkspaceRoot(rootPath, path);
    if (!isInRoot && !includeExternal) {
      return [];
    }

    const preparedResource = preparedResources.get(location.uri);
    const existingModelUri =
      rootPath && isInRoot
        ? monacoModelRegistry(monaco).modelForPath(rootPath, path)?.uri
        : undefined;
    const uri =
      preparedResource ??
      existingModelUri ??
      (rootPath && isInRoot ? toWorkspaceMonacoUri(monaco, rootPath, path) : monaco.Uri.file(path));
    if (!uri) {
      return [];
    }

    return [
      {
        range: new monaco.Range(
          location.range.start.line + 1,
          location.range.start.character + 1,
          location.range.end.line + 1,
          location.range.end.character + 1,
        ),
        uri,
      },
    ];
  });
}

export function preparedJavaScriptTypeScriptNavigationTargetsToMonacoLocations(
  monaco: typeof Monaco,
  targets: readonly JavaScriptTypeScriptPreparedNavigationTarget[],
  rootPath: string,
  includeExternal = false,
): Monaco.languages.Location[] {
  return toJavaScriptTypeScriptMonacoLocations(
    monaco,
    targets.map(({ location }) => location),
    rootPath,
    includeExternal,
    new Map(
      targets.flatMap(({ location, resource }) =>
        resource ? [[location.uri, resource] as const] : [],
      ),
    ),
  );
}
