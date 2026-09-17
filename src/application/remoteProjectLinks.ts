/** Sidebar identity associations only. These do not grant execution or instruction authority. */
const STORAGE_KEY = "codevo.remote-project-links.v1";
const MAX_ENTRIES = 256;
const MAX_STORAGE_CHARS = 2_000_000;
const EMPTY: ReadonlyMap<string, string> = new Map();
let cachedRaw: string | null | undefined;
let cachedLinks: ReadonlyMap<string, string> = EMPTY;
const subscribers = new Set<() => void>();

function publish(): void {
  cachedRaw = undefined;
  for (const notify of subscribers) notify();
}

export function subscribeRemoteProjectLinks(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) publish();
  });
}

function validRemoteKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 5000) return false;
  const parts = key.split(":");
  if (parts.length !== 4 || parts[0] !== "remote") return false;
  try {
    return parts.slice(1).every((part) => {
      const decoded = decodeURIComponent(part);
      return (
        decoded.length > 0 &&
        decoded.length <= 512 &&
        !/\p{Cc}/u.test(decoded) &&
        encodeURIComponent(decoded) === part
      );
    });
  } catch {
    return false;
  }
}

function validRoot(root: unknown): root is string {
  return (
    typeof root === "string" &&
    root.startsWith("/") &&
    root.length > 1 &&
    root.length <= 4096 &&
    new TextEncoder().encode(root).length <= 4096 &&
    !/[\\\p{Cc}]/u.test(root) &&
    !root
      .slice(1)
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  );
}

function parse(raw: string | null): ReadonlyMap<string, string> {
  if (raw === null) return EMPTY;
  if (raw.length > MAX_STORAGE_CHARS) throw new Error("Project connections are too large.");
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > MAX_ENTRIES)
    throw new Error("Invalid project connections.");
  const links = new Map<string, string>();
  for (const value of values) {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !validRemoteKey(value[0]) ||
      !validRoot(value[1]) ||
      links.has(value[0])
    )
      throw new Error("Invalid project connection.");
    links.set(value[0], value[1]);
  }
  return links;
}

/** Invalid preferences fail closed: projects remain separate and their threads stay available. */
export function readRemoteProjectLinks(): ReadonlyMap<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedLinks = parse(raw);
      cachedRaw = raw;
    }
    return cachedLinks;
  } catch {
    return EMPTY;
  }
}

/** Only pass a canonical root from an explicitly selected registered local project. */
export function saveRemoteProjectLink(remoteRootKey: string, canonicalLocalRoot: string): void {
  if (!validRemoteKey(remoteRootKey) || !validRoot(canonicalLocalRoot))
    throw new Error("Select valid server and local projects.");
  const links = new Map(parse(window.localStorage.getItem(STORAGE_KEY)));
  if (!links.has(remoteRootKey) && links.size >= MAX_ENTRIES)
    throw new Error("Remove a project connection before adding another.");
  links.set(remoteRootKey, canonicalLocalRoot);
  const encoded = JSON.stringify([...links]);
  if (encoded.length > MAX_STORAGE_CHARS) throw new Error("Project connections are too large.");
  window.localStorage.setItem(STORAGE_KEY, encoded);
  publish();
}

export function removeRemoteProjectLink(remoteRootKey: string): void {
  if (!validRemoteKey(remoteRootKey)) throw new Error("Invalid server project.");
  const links = new Map(parse(window.localStorage.getItem(STORAGE_KEY)));
  links.delete(remoteRootKey);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...links]));
  publish();
}
