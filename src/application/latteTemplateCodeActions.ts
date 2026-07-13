import { missingLatteTemplateReferenceAt } from "../domain/netteTemplateReferences";
import type {
  PhpCodeActionContext,
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import {
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import { latteProviderRequestContext } from "./latteProviderRequestContext";
import { listLatteTemplateRelativePaths } from "./netteTemplateDiscovery";

export async function provideLatteCodeActions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  range: PhpCodeActionRange,
  _context?: PhpCodeActionContext,
): Promise<PhpCodeActionDescriptor[]> {
  const request = latteProviderRequestContext(options);

  if (!request) {
    return [];
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = request;
  const templateRelativePaths = await listLatteTemplateRelativePaths({
    cache: options.caches.templateCache,
    deps,
    isRequestedRootActive,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxTemplates: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
  });

  if (!isRequestedRootActive() || templateRelativePaths.length === 0) {
    return [];
  }

  const missing = missingLatteTemplateReferenceAt(
    source,
    range.start,
    currentTemplateRelativePath,
    templateRelativePaths,
  );

  if (!missing) {
    return [];
  }

  const path = deps.joinPath(requestedRoot, missing.relativePath);
  const existing = await fileContentOrNull(deps.readFileContent, path);

  if (!isRequestedRootActive() || existing !== null) {
    return [];
  }

  return [
    {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      newFile: {
        content: "",
        path,
        title: "Create Latte Template",
      },
      title: `Create Latte template ${missing.name}`,
    },
  ];
}

async function fileContentOrNull(
  readFileContent: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    return await readFileContent(path);
  } catch {
    return null;
  }
}
