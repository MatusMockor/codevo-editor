const EXPLICIT_PATH_PREFIX = /^(?:~|\.{1,2})\//;
const POSITION_SUFFIX = /:[1-9]\d{0,8}(?::[1-9]\d{0,8})?$/;
const FILE_EXTENSION = /[^.]\.[A-Za-z][A-Za-z0-9]{0,11}$|^\.[A-Za-z][\w-]*$/;
const VERSION_SUFFIX = /\d\.\d[^.]*$/;
const NUMERIC_DOTTED = /^\d+(?:\.\d+)+$/;

const SINGLE_LABEL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost"]);

const GENERIC_HOSTNAME_TLDS: ReadonlySet<string> = new Set([
  "ai",
  "app",
  "biz",
  "cc",
  "chat",
  "cloud",
  "co",
  "com",
  "dev",
  "edu",
  "gg",
  "gov",
  "info",
  "io",
  "link",
  "me",
  "mil",
  "net",
  "online",
  "org",
  "site",
  "store",
  "tech",
  "tv",
  "xyz",
]);

const COUNTRY_HOSTNAME_TLDS: ReadonlySet<string> = new Set([
  "at",
  "au",
  "be",
  "br",
  "ca",
  "ch",
  "cn",
  "cz",
  "de",
  "dk",
  "es",
  "eu",
  "fi",
  "fr",
  "hk",
  "ie",
  "it",
  "jp",
  "kr",
  "mx",
  "nl",
  "no",
  "nz",
  "pl",
  "pt",
  "ru",
  "se",
  "sg",
  "tr",
  "uk",
  "us",
]);

export function hasAgentFilePathPosition(mention: string): boolean {
  return POSITION_SUFFIX.test(mention);
}

export function isAgentFilePathMentionShape(mention: string): boolean {
  const hasPosition = hasAgentFilePathPosition(mention);
  const path = mention.replace(POSITION_SUFFIX, "");
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  if (EXPLICIT_PATH_PREFIX.test(mention)) return true;
  if (!hasPosition && !FILE_EXTENSION.test(basename)) return false;
  if (looksLikeHostname(segments[0] ?? "", hasPosition)) return false;
  return !VERSION_SUFFIX.test(basename);
}

function looksLikeHostname(segment: string, hasPosition: boolean): boolean {
  if (segment.startsWith(".")) return false;
  const lowered = segment.toLowerCase();
  if (SINGLE_LABEL_HOSTNAMES.has(lowered)) return true;
  if (NUMERIC_DOTTED.test(segment)) return true;
  const labels = lowered.split(".");
  const lastLabel = labels[labels.length - 1];
  if (labels.length < 2 || lastLabel === undefined) return false;
  if (GENERIC_HOSTNAME_TLDS.has(lastLabel)) return true;
  return !hasPosition && COUNTRY_HOSTNAME_TLDS.has(lastLabel);
}
