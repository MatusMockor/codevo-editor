import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import type { NetteCreateComponentTypeResolver } from "./netteCreateComponentContracts";
import { factoryDerivedLatteCandidateViewNames } from "./netteFactoryDerivedLatteViewNames";

export interface NetteCandidateViewNamesContext {
  deps: NetteCreateComponentTypeResolver & {
    joinPath(rootPath: string, relativePath: string): string;
    readFileContent(path: string): Promise<string>;
  };
  isRequestedRootActive(): boolean;
  presenterSuffix: string;
  controlSuffix: string;
  requestedRoot: string;
  templateRelativePath: string;
}

const LATTE_TEMPLATE_EXTENSION = ".latte";

/**
 * The `"<Presenter>:<action>"` view names that could render the active template,
 * plus wildcard names used by lifecycle helpers (`beforeRender`, bare `render`).
 * This belongs with view-data matching because it defines which provider entries
 * are in scope for the current template.
 */
export async function latteCandidateViewNames(
  context: NetteCandidateViewNamesContext,
): Promise<string[]> {
  const {
    controlSuffix,
    deps,
    isRequestedRootActive,
    presenterSuffix,
    requestedRoot,
    templateRelativePath,
  } = context;
  const action = latteActionFromTemplatePath(templateRelativePath);
  const names = new Set<string>();

  for (const ownerPath of [
    ...presenterCandidatePathsForTemplate(templateRelativePath),
    ...componentClassCandidatePathsForTemplate(templateRelativePath),
  ]) {
    const fileName = ownerPath.split("/").pop() ?? "";
    const isControl = fileName.endsWith(controlSuffix);
    const suffix = fileName.endsWith(presenterSuffix)
      ? presenterSuffix
      : isControl
        ? controlSuffix
        : null;

    if (!suffix) {
      continue;
    }

    const shortName = fileName.slice(0, -suffix.length);

    names.add(`${shortName}:${action}`);
    names.add(`${shortName}:*`);

    if (isControl) {
      names.add(`${shortName}:default`);
    }
  }

  for (const name of await factoryDerivedLatteCandidateViewNames({
    action,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
  })) {
    if (!isRequestedRootActive()) {
      return [];
    }

    names.add(name);
  }

  return Array.from(names);
}

/**
 * The view/action name a template file renders: the base name without the
 * `.latte` extension, and for the classic dotted `Product.show.latte` form the
 * segment after the final dot (`show`).
 */
function latteActionFromTemplatePath(templateRelativePath: string): string {
  const fileName = templateRelativePath.split("/").pop() ?? "";
  const base = fileName.endsWith(LATTE_TEMPLATE_EXTENSION)
    ? fileName.slice(0, -LATTE_TEMPLATE_EXTENSION.length)
    : fileName;
  const dotIndex = base.lastIndexOf(".");

  if (dotIndex >= 0 && dotIndex < base.length - 1) {
    return base.slice(dotIndex + 1);
  }

  return base.length > 0 ? base : "default";
}
