import type { TestGutterTarget } from "./testGutterTargets";
import { normalizedJsTestRelativeFilePath } from "./jsTestRunScope";
import {
  parseJsTestExplorerFilter,
  type JsTestExplorerFilterOptions,
} from "./jsTestExplorerFilter";
import { joinWorkspacePath } from "./workspace";
import { parseWorkspacePath } from "./workspacePath";

export type JsTestExplorerStatus = "idle" | "running" | "passed" | "failed" | "skipped";

export interface JsTestExplorerTestDiscovery {
  readonly filePath: string;
  readonly parameterized?: boolean;
  readonly status?: JsTestExplorerStatus;
  readonly suitePath: readonly string[];
  readonly target: TestGutterTarget;
}

export interface JsTestExplorerTestNode {
  readonly filePath: string;
  readonly id: string;
  readonly kind: "test";
  readonly label: string;
  readonly parameterized: boolean;
  readonly status: JsTestExplorerStatus;
  readonly suitePath: readonly string[];
  readonly target: TestGutterTarget;
}

export interface JsTestExplorerSuiteNode {
  readonly children: readonly (JsTestExplorerSuiteNode | JsTestExplorerTestNode)[];
  readonly filePath: string;
  readonly id: string;
  readonly kind: "suite";
  readonly label: string;
  readonly status: JsTestExplorerStatus;
  readonly suitePath: readonly string[];
}

export interface JsTestExplorerFileNode {
  readonly children: readonly JsTestExplorerSuiteNode[];
  readonly documentIdentityEligible?: boolean;
  readonly filePath: string;
  readonly id: string;
  readonly kind: "file";
  readonly label: string;
  readonly status: JsTestExplorerStatus;
}

export interface JsTestExplorerWorkspaceNode {
  readonly children: readonly JsTestExplorerFileNode[];
  readonly id: string;
  readonly kind: "workspace";
  readonly label: string;
  readonly rootPath: string;
  readonly status: JsTestExplorerStatus;
  readonly workspaceId?: string | null;
}

export type JsTestExplorerNode =
  | JsTestExplorerWorkspaceNode
  | JsTestExplorerFileNode
  | JsTestExplorerSuiteNode
  | JsTestExplorerTestNode;

interface MutableSuite {
  readonly childSuites: Map<string, MutableSuite>;
  readonly filePath: string;
  readonly suitePath: readonly string[];
  readonly tests: Map<string, JsTestExplorerTestNode>;
  documentIdentityEligible: boolean;
}

const statusPriority: Readonly<Record<JsTestExplorerStatus, number>> = {
  failed: 4,
  running: 3,
  passed: 2,
  skipped: 1,
  idle: 0,
};

/**
 * Aggregation is deliberately failure-first: a completed failure remains visible while sibling
 * tests are still running. Passed wins over skipped/idle for partially executed collections.
 * Empty collections are idle.
 */
export function aggregateJsTestExplorerStatus(
  statuses: readonly JsTestExplorerStatus[],
): JsTestExplorerStatus {
  let aggregate: JsTestExplorerStatus = "idle";

  for (const status of statuses) {
    if (statusPriority[status] > statusPriority[aggregate]) {
      aggregate = status;
    }
  }

  return aggregate;
}

export function jsTestExplorerTestId(discovery: JsTestExplorerTestDiscovery): string {
  const filePath = normalizePath(discovery.filePath);
  return stableId("test", [
    filePath,
    ...discovery.suitePath,
    discovery.target.filter,
    String(discovery.target.position.lineNumber),
    String(discovery.target.position.column),
  ]);
}

export function buildJsTestExplorerTree(
  rootPath: string,
  discoveries: readonly JsTestExplorerTestDiscovery[],
  workspaceId: string | null = null,
): JsTestExplorerWorkspaceNode {
  const normalizedRoot = normalizePath(rootPath);
  const rootsByFile = new Map<string, MutableSuite>();

  // Test identity assumes a source position is stable within one discovery snapshot. Exact
  // duplicates are coalesced; conflicting duplicate statuses use the same failure-first policy.
  for (const discovery of sortedDiscoveries(discoveries)) {
    const filePath = normalizePath(discovery.filePath);
    const rootSuite = mapValue(rootsByFile, filePath, () => mutableSuite(filePath, []));
    rootSuite.documentIdentityEligible &&= isCanonicalRelativeFilePath(discovery.filePath);
    const suite = ensureSuitePath(rootSuite, discovery.suitePath);
    const id = jsTestExplorerTestId({ ...discovery, filePath });
    const previous = suite.tests.get(id);
    const status = aggregateJsTestExplorerStatus([
      previous?.status ?? "idle",
      discovery.status ?? "idle",
    ]);

    suite.tests.set(id, {
      filePath,
      id,
      kind: "test",
      label: discovery.target.filter,
      parameterized: discovery.parameterized ?? false,
      status,
      suitePath: [...discovery.suitePath],
      target: discovery.target,
    });
  }

  const children = [...rootsByFile.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([filePath, rootSuite]) => fileNode(filePath, rootSuite));

  return {
    children,
    id: stableId("workspace", workspaceId ? [workspaceId, normalizedRoot] : [normalizedRoot]),
    kind: "workspace",
    label: normalizedRoot,
    rootPath: normalizedRoot,
    status: aggregateJsTestExplorerStatus(children.map(({ status }) => status)),
    workspaceId,
  };
}

/** Filtering preserves aggregate statuses from the complete tree, not only the visible matches. */
export function filterJsTestExplorerTree(
  tree: JsTestExplorerWorkspaceNode,
  query: string,
  options: JsTestExplorerFilterOptions = {},
): JsTestExplorerWorkspaceNode {
  const filter = parseJsTestExplorerFilter(query, options);
  if (filter.kind === "invalid") {
    return { ...tree, children: [] };
  }

  const currentFile = filter.currentFile;
  const openedFiles = filter.openedFilesSnapshot;
  if (
    (currentFile && !documentIdentityBelongsToTree(tree, currentFile)) ||
    (openedFiles && !documentRootBelongsToTree(tree, openedFiles.root))
  ) {
    return { ...tree, children: [] };
  }
  const currentFileProjection =
    currentFile === undefined
      ? tree
      : {
          ...tree,
          children: tree.children.filter((file) => fileMatchesDocumentIdentity(file, currentFile)),
        };
  const fileProjection =
    openedFiles === undefined || !openedFiles.hadEditorResources
      ? currentFileProjection
      : {
          ...currentFileProjection,
          children: currentFileProjection.children.filter((file) =>
            openedFiles.identities.some((identity) => fileMatchesDocumentIdentity(file, identity)),
          ),
        };
  const textProjection =
    filter.textQuery.length === 0
      ? fileProjection
      : {
          ...fileProjection,
          children: fileProjection.children.flatMap((file) => {
            const filtered = filterFile(file, filter.textQuery);
            return filtered ? [filtered] : [];
          }),
        };
  return filter.statusFilters.includes("failed")
    ? filterTreeByTestStatus(textProjection, (status) => status === "failed")
    : filter.statusFilters.includes("executed")
      ? filterTreeByTestStatus(textProjection, (status) => status !== "idle")
      : textProjection;
}

function documentIdentityBelongsToTree(
  tree: JsTestExplorerWorkspaceNode,
  identity: NonNullable<JsTestExplorerFilterOptions["currentFile"]>,
): boolean {
  return documentRootBelongsToTree(tree, identity.root);
}

function documentRootBelongsToTree(
  tree: JsTestExplorerWorkspaceNode,
  root: NonNullable<JsTestExplorerFilterOptions["currentFile"]>["root"],
): boolean {
  if (tree.workspaceId !== root.workspaceId) return false;
  try {
    const treeRoot = parseWorkspacePath(root, tree.rootPath);
    return treeRoot.ok && treeRoot.value.relativePath === "";
  } catch {
    return false;
  }
}

function fileMatchesDocumentIdentity(
  file: JsTestExplorerFileNode,
  identity: NonNullable<JsTestExplorerFilterOptions["currentFile"]>,
): boolean {
  try {
    if (!file.documentIdentityEligible) return false;
    const { filePath } = file;
    if (normalizedJsTestRelativeFilePath(filePath) !== filePath) return false;
    const candidate = parseWorkspacePath(
      identity.root,
      joinWorkspacePath(identity.root.nativePath, filePath),
    );
    return candidate.ok && candidate.value.key === identity.pathKey;
  } catch {
    return false;
  }
}

export function flattenJsTestExplorerTree(tree: JsTestExplorerWorkspaceNode): JsTestExplorerNode[] {
  const flattened: JsTestExplorerNode[] = [];

  const visit = (node: JsTestExplorerNode): void => {
    flattened.push(node);
    if (node.kind !== "test") {
      node.children.forEach(visit);
    }
  };

  visit(tree);
  return flattened;
}

function fileNode(filePath: string, rootSuite: MutableSuite): JsTestExplorerFileNode {
  const children = topLevelSuites(rootSuite);
  return {
    children,
    documentIdentityEligible: rootSuite.documentIdentityEligible,
    filePath,
    id: stableId("file", [filePath]),
    kind: "file",
    label: basename(filePath),
    status: aggregateJsTestExplorerStatus(children.map(({ status }) => status)),
  };
}

function suiteNode(suite: MutableSuite): JsTestExplorerSuiteNode {
  const children = suiteChildren(suite);
  return {
    children,
    filePath: suite.filePath,
    id: stableId("suite", [suite.filePath, ...suite.suitePath]),
    kind: "suite",
    // Tests declared outside describe still live below a synthetic suite so the public tree
    // always follows workspace -> file -> suite -> test.
    label: suite.suitePath[suite.suitePath.length - 1] ?? "(root)",
    status: aggregateJsTestExplorerStatus(children.map(({ status }) => status)),
    suitePath: suite.suitePath,
  };
}

function suiteChildren(
  suite: MutableSuite,
): readonly (JsTestExplorerSuiteNode | JsTestExplorerTestNode)[] {
  const childSuites = [...suite.childSuites.values()].map(suiteNode);
  const tests = [...suite.tests.values()];
  return [...childSuites, ...tests].sort(compareNodes);
}

function topLevelSuites(rootSuite: MutableSuite): readonly JsTestExplorerSuiteNode[] {
  const childSuites = [...rootSuite.childSuites.values()].map(suiteNode).sort(compareNodes);
  const tests = [...rootSuite.tests.values()];
  if (tests.length > 0) {
    const rootTests: JsTestExplorerSuiteNode = {
      children: tests.sort(compareNodes),
      filePath: rootSuite.filePath,
      id: stableId("suite", [rootSuite.filePath]),
      kind: "suite",
      label: "(root)",
      status: aggregateJsTestExplorerStatus(tests.map(({ status }) => status)),
      suitePath: [],
    };
    return [rootTests, ...childSuites];
  }
  return childSuites;
}

function ensureSuitePath(root: MutableSuite, suitePath: readonly string[]): MutableSuite {
  let current = root;
  for (let index = 0; index < suitePath.length; index += 1) {
    const path = suitePath.slice(0, index + 1);
    const label = path[path.length - 1] ?? "";
    current = mapValue(current.childSuites, label, () => mutableSuite(root.filePath, path));
  }
  return current;
}

function mutableSuite(filePath: string, suitePath: readonly string[]): MutableSuite {
  return {
    childSuites: new Map(),
    documentIdentityEligible: true,
    filePath,
    suitePath,
    tests: new Map(),
  };
}

function isCanonicalRelativeFilePath(path: string): boolean {
  try {
    return normalizedJsTestRelativeFilePath(path) === path;
  } catch {
    return false;
  }
}

function filterFile(file: JsTestExplorerFileNode, query: string): JsTestExplorerFileNode | null {
  if (matches(file.label, query) || matches(file.filePath, query)) {
    return file;
  }

  const children = file.children.flatMap((suite) => {
    const filtered = filterSuite(suite, query);
    return filtered ? [filtered] : [];
  });
  return children.length > 0 ? { ...file, children } : null;
}

function filterSuite(
  suite: JsTestExplorerSuiteNode,
  query: string,
): JsTestExplorerSuiteNode | null {
  if (matches(suite.label, query)) {
    return suite;
  }

  const children: Array<JsTestExplorerSuiteNode | JsTestExplorerTestNode> = [];
  suite.children.forEach((child) => {
    if (child.kind === "test") {
      if (matches(child.label, query)) {
        children.push(child);
      }
      return;
    }
    const filtered = filterSuite(child, query);
    if (filtered) {
      children.push(filtered);
    }
  });
  return children.length > 0 ? { ...suite, children } : null;
}

function filterTreeByTestStatus(
  tree: JsTestExplorerWorkspaceNode,
  matchesStatus: (status: JsTestExplorerStatus) => boolean,
): JsTestExplorerWorkspaceNode {
  return {
    ...tree,
    children: tree.children.flatMap((file) => {
      const filtered = filterFileByTestStatus(file, matchesStatus);
      return filtered ? [filtered] : [];
    }),
  };
}

function filterFileByTestStatus(
  file: JsTestExplorerFileNode,
  matchesStatus: (status: JsTestExplorerStatus) => boolean,
): JsTestExplorerFileNode | null {
  const children = file.children.flatMap((suite) => {
    const filtered = filterSuiteByTestStatus(suite, matchesStatus);
    return filtered ? [filtered] : [];
  });
  return children.length > 0 ? { ...file, children } : null;
}

function filterSuiteByTestStatus(
  suite: JsTestExplorerSuiteNode,
  matchesStatus: (status: JsTestExplorerStatus) => boolean,
): JsTestExplorerSuiteNode | null {
  const children: Array<JsTestExplorerSuiteNode | JsTestExplorerTestNode> = [];
  for (const child of suite.children) {
    if (child.kind === "test") {
      if (matchesStatus(child.status)) children.push(child);
      continue;
    }
    const filtered = filterSuiteByTestStatus(child, matchesStatus);
    if (filtered) children.push(filtered);
  }
  return children.length > 0 ? { ...suite, children } : null;
}

function sortedDiscoveries(
  discoveries: readonly JsTestExplorerTestDiscovery[],
): JsTestExplorerTestDiscovery[] {
  return [...discoveries].sort(
    (left, right) =>
      compareText(normalizePath(left.filePath), normalizePath(right.filePath)) ||
      compareText(left.suitePath.join("\u0000"), right.suitePath.join("\u0000")) ||
      left.target.position.lineNumber - right.target.position.lineNumber ||
      left.target.position.column - right.target.position.column ||
      compareText(left.target.filter, right.target.filter),
  );
}

function compareNodes(
  left: JsTestExplorerSuiteNode | JsTestExplorerTestNode,
  right: JsTestExplorerSuiteNode | JsTestExplorerTestNode,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "suite" ? -1 : 1;
  }
  return compareText(left.label, right.label) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matches(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query);
}

function stableId(kind: JsTestExplorerNode["kind"], components: readonly string[]): string {
  return `js-test:${kind}:${components.map((component) => encodeURIComponent(component)).join("/")}`;
}

function normalizePath(path: string): string {
  const slashed = path.split("\\").join("/");
  const uncPrefix = slashed.startsWith("//") ? "//" : "";
  const normalized = `${uncPrefix}${slashed.slice(uncPrefix.length).replace(/\/{2,}/g, "/")}`;
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function mapValue<Key, Value>(map: Map<Key, Value>, key: Key, create: () => Value): Value {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}
