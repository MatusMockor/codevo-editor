import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { createMonacoLinkOpener, registerMonacoLinkOpener } from "./monacoLinkOpener";

function uri(value: string): Monaco.Uri {
  return {
    toString: (skipEncoding?: boolean) => (skipEncoding ? value : encodeURI(value)),
  } as unknown as Monaco.Uri;
}

describe("createMonacoLinkOpener", () => {
  it("sends http and https links through the opener gateway and claims them", async () => {
    const openUrl = vi.fn(async () => undefined);
    const opener = createMonacoLinkOpener(openUrl);

    await expect(opener.open(uri("https://example.com/a"))).resolves.toBe(true);
    await expect(opener.open(uri("http://localhost:5173/"))).resolves.toBe(true);

    expect(openUrl.mock.calls).toEqual([["https://example.com/a"], ["http://localhost:5173/"]]);
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "vscode://x",
    "mailto:a@b.c",
    "ms-settings:x",
  ])("claims %s without opening it so Monaco's default openers never run", async (value) => {
    const openUrl = vi.fn(async () => undefined);

    await expect(createMonacoLinkOpener(openUrl).open(uri(value))).resolves.toBe(true);

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("leaves command links to Monaco's allowlisted command opener", async () => {
    const openUrl = vi.fn(async () => undefined);

    await expect(
      createMonacoLinkOpener(openUrl).open(uri("command:debug.hover.copyEvaluatePath")),
    ).resolves.toBe(false);

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("keeps a failed external open claimed", async () => {
    const openUrl = vi.fn(async () => {
      throw new Error("denied");
    });

    await expect(createMonacoLinkOpener(openUrl).open(uri("https://example.com"))).resolves.toBe(
      true,
    );
  });
});

describe("createMonacoLinkOpener with real Monaco URIs", () => {
  it("opens the link exactly as written, without percent-encoding its query or fragment", async () => {
    const { URI } = await import("monaco-editor/esm/vs/base/common/uri.js");
    const openUrl = vi.fn(async () => undefined);
    const link = "https://example.com/search?q=a&b=2#section-1";

    await createMonacoLinkOpener(openUrl).open(URI.parse(link) as unknown as Monaco.Uri);

    expect(openUrl).toHaveBeenCalledWith(link);
  });
});

describe("registerMonacoLinkOpener", () => {
  it("registers the opener with Monaco and returns its disposable", () => {
    const disposable = { dispose: vi.fn() };
    const registerLinkOpener = vi.fn(() => disposable);
    const monaco = { editor: { registerLinkOpener } } as unknown as typeof Monaco;

    expect(registerMonacoLinkOpener(monaco)).toBe(disposable);
    expect(registerLinkOpener).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the Monaco runtime has no link opener registry", () => {
    const monaco = { editor: {} } as unknown as typeof Monaco;

    expect(registerMonacoLinkOpener(monaco)).toBeNull();
  });
});
