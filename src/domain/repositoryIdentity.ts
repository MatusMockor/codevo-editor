/** Display grouping identity only; never grants execution or workspace authority. */
export function canonicalRepositoryIdentity(raw: string): string | null {
  if (!raw || raw.length > 2048 || /[^\x21-\x7e]/.test(raw) || /[?#\\]/.test(raw)) return null;
  let authority: string;
  let path: string;
  let scheme = "ssh";
  const url = /^(https?|ssh|git):\/\/([^/]+)\/(.+)$/.exec(raw);
  if (url) {
    [, scheme, authority, path] = url;
  } else {
    const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/.exec(raw);
    if (!scp) return null;
    [, authority, path] = scp;
  }
  authority = authority.slice(authority.lastIndexOf("@") + 1).toLowerCase();
  const hostMatch = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/.exec(authority);
  if (!hostMatch || !hostMatch[1].includes(".") || hostMatch[1].includes("..")) return null;
  const host = hostMatch[1];
  const port = hostMatch[2] ? Number(hostMatch[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  const defaultPort = { https: 443, http: 80, ssh: 22, git: 9418 }[scheme];
  path = path.replace(/\/+$/, "").replace(/\.git$/, "");
  if (
    !/^[A-Za-z0-9_.~/-]+$/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  if (host === "github.com") path = path.toLowerCase();
  return `${host}${port !== null && port !== defaultPort ? `:${port}` : ""}/${path}`;
}

/** Validate the already-sanitized wire key without stripping a repository's literal .git suffix. */
export function isCanonicalRepositoryIdentity(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const match =
    /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([1-9][0-9]{0,4}))?\/([A-Za-z0-9_.~/-]+)$/.exec(value);
  if (!match) return false;
  const [, host, port, path] = match;
  return (
    host.includes(".") &&
    !host.includes("..") &&
    (!port || Number(port) <= 65535) &&
    (host !== "github.com" || path === path.toLowerCase()) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
