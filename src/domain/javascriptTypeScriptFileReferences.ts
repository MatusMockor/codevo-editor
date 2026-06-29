import {
  pathFromLanguageServerUri,
  type LanguageServerCodeActionCommand,
  type LanguageServerLocation,
} from "./languageServerFeatures";
import { fileUriFromPath } from "./languageServerDocumentSync";

const FIND_ALL_FILE_REFERENCES_COMMAND = "_typescript.findAllFileReferences";

export function findAllFileReferencesCommand(
  path: string,
): LanguageServerCodeActionCommand {
  return {
    arguments: [fileUriFromPath(path)],
    command: FIND_ALL_FILE_REFERENCES_COMMAND,
    title: "Find File References",
  };
}

export function filterFileReferenceLocationsToWorkspace(
  locations: LanguageServerLocation[],
  workspaceRoot: string,
): LanguageServerLocation[] {
  const rootPrefix = workspaceRoot.endsWith("/")
    ? workspaceRoot
    : `${workspaceRoot}/`;

  return locations.filter((location) => {
    const path = pathFromLanguageServerUri(location.uri);

    return Boolean(path && (path === workspaceRoot || path.startsWith(rootPrefix)));
  });
}
