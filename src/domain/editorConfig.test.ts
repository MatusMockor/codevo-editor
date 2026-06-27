import { describe, expect, it } from "vitest";
import {
  applyEditorConfigOnSave,
  editorConfigDirectoriesForFile,
  editorConfigEol,
  editorConfigFormattingOptions,
  editorConfigGlobMatches,
  editorConfigPathForDirectory,
  parseEditorConfig,
  resolveEditorConfigSettings,
  type EditorConfigFile,
} from "./editorConfig";

describe("parseEditorConfig", () => {
  it("parses root flag (preamble before any section)", () => {
    const parsed = parseEditorConfig("root = true\n");

    expect(parsed.root).toBe(true);
    expect(parsed.sections).toEqual([]);
  });

  it("defaults root to false when absent", () => {
    const parsed = parseEditorConfig("[*]\nindent_style = space\n");

    expect(parsed.root).toBe(false);
  });

  it("treats root values case-insensitively and trims", () => {
    expect(parseEditorConfig("root = TRUE").root).toBe(true);
    expect(parseEditorConfig("  root=true  ").root).toBe(true);
    expect(parseEditorConfig("root = false").root).toBe(false);
  });

  it("parses a glob section with properties", () => {
    const parsed = parseEditorConfig(
      [
        "root = true",
        "",
        "[*]",
        "indent_style = space",
        "indent_size = 4",
        "end_of_line = lf",
        "charset = utf-8",
        "trim_trailing_whitespace = true",
        "insert_final_newline = true",
      ].join("\n"),
    );

    expect(parsed.root).toBe(true);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].glob).toBe("*");
    expect(parsed.sections[0].properties).toEqual({
      indent_style: "space",
      indent_size: "4",
      end_of_line: "lf",
      charset: "utf-8",
      trim_trailing_whitespace: "true",
      insert_final_newline: "true",
    });
  });

  it("parses multiple sections and tab_width", () => {
    const parsed = parseEditorConfig(
      [
        "[*.php]",
        "indent_style = space",
        "indent_size = 4",
        "",
        "[*.js]",
        "indent_style = tab",
        "tab_width = 2",
      ].join("\n"),
    );

    expect(parsed.sections.map((section) => section.glob)).toEqual([
      "*.php",
      "*.js",
    ]);
    expect(parsed.sections[1].properties).toEqual({
      indent_style: "tab",
      tab_width: "2",
    });
  });

  it("lower-cases property keys and known enum values but preserves arbitrary values", () => {
    const parsed = parseEditorConfig(
      ["[*]", "Indent_Style = Space", "End_Of_Line = CRLF"].join("\n"),
    );

    expect(parsed.sections[0].properties).toEqual({
      indent_style: "space",
      end_of_line: "crlf",
    });
  });

  it("ignores comments (# and ;) and blank lines", () => {
    const parsed = parseEditorConfig(
      [
        "# a comment",
        "root = true",
        "; another comment",
        "",
        "[*]",
        "  indent_style = space # inline-ish",
        "indent_size = 2",
      ].join("\n"),
    );

    expect(parsed.root).toBe(true);
    expect(parsed.sections[0].properties.indent_style).toBe("space");
    expect(parsed.sections[0].properties.indent_size).toBe("2");
  });

  it("ignores malformed lines without a section or equals sign", () => {
    const parsed = parseEditorConfig(
      ["garbage line", "[*]", "no-equals-here", "indent_size = 4"].join("\n"),
    );

    expect(parsed.sections[0].properties).toEqual({ indent_size: "4" });
  });
});

describe("editorConfigGlobMatches", () => {
  it("matches a bare '*' against any file in the same directory tree", () => {
    expect(editorConfigGlobMatches("*", "file.php")).toBe(true);
    expect(editorConfigGlobMatches("*", "src/file.php")).toBe(true);
  });

  it("matches an extension glob", () => {
    expect(editorConfigGlobMatches("*.php", "app/User.php")).toBe(true);
    expect(editorConfigGlobMatches("*.php", "app/User.js")).toBe(false);
  });

  it("'*' does not cross a path separator but '**' does", () => {
    expect(editorConfigGlobMatches("src/*.php", "src/User.php")).toBe(true);
    expect(editorConfigGlobMatches("src/*.php", "src/models/User.php")).toBe(
      false,
    );
    expect(editorConfigGlobMatches("src/**.php", "src/models/User.php")).toBe(
      true,
    );
    expect(editorConfigGlobMatches("**/*.php", "a/b/c/User.php")).toBe(true);
  });

  it("supports brace alternation {a,b}", () => {
    expect(editorConfigGlobMatches("*.{js,ts}", "app.ts")).toBe(true);
    expect(editorConfigGlobMatches("*.{js,ts}", "app.js")).toBe(true);
    expect(editorConfigGlobMatches("*.{js,ts}", "app.php")).toBe(false);
  });

  it("supports character classes [...]", () => {
    expect(editorConfigGlobMatches("file[0-9].php", "file3.php")).toBe(true);
    expect(editorConfigGlobMatches("file[0-9].php", "fileA.php")).toBe(false);
    expect(editorConfigGlobMatches("file[!0-9].php", "fileA.php")).toBe(true);
  });

  it("supports single-char '?'", () => {
    expect(editorConfigGlobMatches("file?.php", "file1.php")).toBe(true);
    expect(editorConfigGlobMatches("file?.php", "file12.php")).toBe(false);
  });

  it("anchors a glob containing a slash to the config directory root", () => {
    expect(editorConfigGlobMatches("lib/*.php", "lib/User.php")).toBe(true);
    expect(editorConfigGlobMatches("lib/*.php", "app/lib/User.php")).toBe(false);
  });

  it("matches a slash-less glob at any depth", () => {
    expect(editorConfigGlobMatches("*.php", "a/b/c/User.php")).toBe(true);
  });
});

describe("resolveEditorConfigSettings", () => {
  function file(
    directory: string,
    content: string,
  ): EditorConfigFile {
    return { directory, parsed: parseEditorConfig(content) };
  }

  it("returns empty settings when no file matches", () => {
    const resolved = resolveEditorConfigSettings(
      [file("/ws", "[*.js]\nindent_style = tab")],
      "/ws/app/User.php",
      "/ws",
    );

    expect(resolved).toEqual({});
  });

  it("resolves indent_style/indent_size/end_of_line for a matching section", () => {
    const resolved = resolveEditorConfigSettings(
      [
        file(
          "/ws",
          [
            "root = true",
            "[*]",
            "indent_style = space",
            "indent_size = 4",
            "end_of_line = lf",
            "trim_trailing_whitespace = true",
            "insert_final_newline = true",
          ].join("\n"),
        ),
      ],
      "/ws/app/User.php",
      "/ws",
    );

    expect(resolved).toEqual({
      indentStyle: "space",
      indentSize: 4,
      tabWidth: 4,
      endOfLine: "lf",
      charset: undefined,
      trimTrailingWhitespace: true,
      insertFinalNewline: true,
    });
  });

  it("falls back tab_width to indent_size and vice versa per spec", () => {
    const tabIndent = resolveEditorConfigSettings(
      [file("/ws", "[*]\nindent_style = tab\ntab_width = 8")],
      "/ws/User.php",
      "/ws",
    );
    expect(tabIndent.indentSize).toBe(8);
    expect(tabIndent.tabWidth).toBe(8);

    const spaceIndent = resolveEditorConfigSettings(
      [file("/ws", "[*]\nindent_style = space\nindent_size = 2")],
      "/ws/User.php",
      "/ws",
    );
    expect(spaceIndent.tabWidth).toBe(2);
  });

  it("treats indent_size = tab as using tab_width", () => {
    const resolved = resolveEditorConfigSettings(
      [file("/ws", "[*]\nindent_style = tab\nindent_size = tab\ntab_width = 3")],
      "/ws/User.php",
      "/ws",
    );

    expect(resolved.indentSize).toBe(3);
    expect(resolved.tabWidth).toBe(3);
  });

  it("more specific (later) sections override earlier ones within a file", () => {
    const resolved = resolveEditorConfigSettings(
      [
        file(
          "/ws",
          [
            "[*]",
            "indent_style = space",
            "indent_size = 2",
            "",
            "[*.php]",
            "indent_size = 4",
          ].join("\n"),
        ),
      ],
      "/ws/app/User.php",
      "/ws",
    );

    expect(resolved.indentStyle).toBe("space");
    expect(resolved.indentSize).toBe(4);
  });

  it("closer (deeper) config directories override parent directories", () => {
    const resolved = resolveEditorConfigSettings(
      [
        file("/ws", "[*]\nindent_style = space\nindent_size = 2"),
        file("/ws/app", "[*]\nindent_size = 4"),
      ],
      "/ws/app/User.php",
      "/ws",
    );

    expect(resolved.indentStyle).toBe("space");
    expect(resolved.indentSize).toBe(4);
  });

  it("stops cascading at a root = true file (parents above it are ignored)", () => {
    const resolved = resolveEditorConfigSettings(
      [
        file("/ws", "[*]\nindent_size = 2\nend_of_line = crlf"),
        file("/ws/app", "root = true\n[*]\nindent_size = 4"),
      ],
      "/ws/app/User.php",
      "/ws",
    );

    expect(resolved.indentSize).toBe(4);
    // end_of_line from /ws must NOT bleed through because /ws/app is root
    expect(resolved.endOfLine).toBeUndefined();
  });

  it("ignores config files that are not ancestors of the file path", () => {
    const resolved = resolveEditorConfigSettings(
      [
        file("/ws/other", "[*]\nindent_size = 8"),
        file("/ws/app", "[*]\nindent_size = 4"),
      ],
      "/ws/app/User.php",
      "/ws",
    );

    expect(resolved.indentSize).toBe(4);
  });

  it("only applies properties from matching globs", () => {
    const resolved = resolveEditorConfigSettings(
      [
        file(
          "/ws",
          ["[*.js]", "indent_size = 2", "[*.php]", "indent_size = 4"].join("\n"),
        ),
      ],
      "/ws/User.php",
      "/ws",
    );

    expect(resolved.indentSize).toBe(4);
  });
});

describe("editorConfigDirectoriesForFile", () => {
  it("lists the file directory up to the workspace root, deepest first", () => {
    expect(
      editorConfigDirectoriesForFile("/ws/app/models/User.php", "/ws"),
    ).toEqual(["/ws/app/models", "/ws/app", "/ws"]);
  });

  it("returns just the root when the file lives directly in it", () => {
    expect(editorConfigDirectoriesForFile("/ws/User.php", "/ws")).toEqual([
      "/ws",
    ]);
  });

  it("normalizes trailing slashes and backslashes", () => {
    expect(
      editorConfigDirectoriesForFile("/ws/app\\User.php", "/ws/"),
    ).toEqual(["/ws/app", "/ws"]);
  });

  it("returns nothing for a file outside the workspace root", () => {
    expect(editorConfigDirectoriesForFile("/other/User.php", "/ws")).toEqual([]);
  });
});

describe("editorConfigPathForDirectory", () => {
  it("appends the .editorconfig filename", () => {
    expect(editorConfigPathForDirectory("/ws/app")).toBe(
      "/ws/app/.editorconfig",
    );
    expect(editorConfigPathForDirectory("/ws/app/")).toBe(
      "/ws/app/.editorconfig",
    );
  });
});

describe("editorConfigFormattingOptions", () => {
  it("maps space indent settings to Monaco-style formatting options", () => {
    expect(
      editorConfigFormattingOptions({ indentStyle: "space", indentSize: 4 }),
    ).toEqual({ insertSpaces: true, tabSize: 4 });
  });

  it("maps tab indent settings to insertSpaces=false using tab_width", () => {
    expect(
      editorConfigFormattingOptions({
        indentStyle: "tab",
        indentSize: 8,
        tabWidth: 8,
      }),
    ).toEqual({ insertSpaces: false, tabSize: 8 });
  });

  it("returns null when indent_style is unset (no override)", () => {
    expect(editorConfigFormattingOptions({})).toBeNull();
    expect(
      editorConfigFormattingOptions({ trimTrailingWhitespace: true }),
    ).toBeNull();
  });

  it("returns null when indent_style is set without a size (keeps editor default size)", () => {
    expect(editorConfigFormattingOptions({ indentStyle: "space" })).toBeNull();
  });
});

describe("editorConfigEol", () => {
  it("maps lf/crlf to monaco-style EOL strings", () => {
    expect(editorConfigEol({ endOfLine: "lf" })).toBe("\n");
    expect(editorConfigEol({ endOfLine: "crlf" })).toBe("\r\n");
  });

  it("returns null when end_of_line is unset", () => {
    expect(editorConfigEol({})).toBeNull();
    expect(editorConfigEol({ indentStyle: "space" })).toBeNull();
  });
});

describe("applyEditorConfigOnSave", () => {
  it("trims trailing whitespace on every line when enabled", () => {
    const result = applyEditorConfigOnSave("a = 1   \nb = 2\t\n", {
      trimTrailingWhitespace: true,
    });

    expect(result).toBe("a = 1\nb = 2\n");
  });

  it("does not trim trailing whitespace when disabled or unset", () => {
    expect(applyEditorConfigOnSave("a = 1   \n", {})).toBe("a = 1   \n");
    expect(
      applyEditorConfigOnSave("a = 1   \n", {
        trimTrailingWhitespace: false,
      }),
    ).toBe("a = 1   \n");
  });

  it("inserts a final newline when enabled and missing", () => {
    expect(
      applyEditorConfigOnSave("a = 1", { insertFinalNewline: true }),
    ).toBe("a = 1\n");
  });

  it("does not duplicate an existing final newline", () => {
    expect(
      applyEditorConfigOnSave("a = 1\n", { insertFinalNewline: true }),
    ).toBe("a = 1\n");
  });

  it("does not add a final newline to empty content", () => {
    expect(applyEditorConfigOnSave("", { insertFinalNewline: true })).toBe("");
  });

  it("uses the configured EOL for an inserted final newline", () => {
    expect(
      applyEditorConfigOnSave("a = 1", {
        insertFinalNewline: true,
        endOfLine: "crlf",
      }),
    ).toBe("a = 1\r\n");
  });

  it("normalizes line endings to the configured EOL", () => {
    expect(
      applyEditorConfigOnSave("a\r\nb\n", { endOfLine: "lf" }),
    ).toBe("a\nb\n");
    expect(
      applyEditorConfigOnSave("a\nb\n", { endOfLine: "crlf" }),
    ).toBe("a\r\nb\r\n");
  });

  it("trims, normalizes EOL, and inserts final newline together", () => {
    expect(
      applyEditorConfigOnSave("a   \r\nb\t", {
        trimTrailingWhitespace: true,
        insertFinalNewline: true,
        endOfLine: "lf",
      }),
    ).toBe("a\nb\n");
  });

  it("returns content unchanged when no on-save settings apply", () => {
    const content = "a = 1   \nb = 2";
    expect(applyEditorConfigOnSave(content, { indentStyle: "space" })).toBe(
      content,
    );
  });

  it("trim-only does not add a trailing newline to content that lacks one", () => {
    expect(
      applyEditorConfigOnSave("a   \nb   ", { trimTrailingWhitespace: true }),
    ).toBe("a\nb");
  });

  it("trim-only preserves an existing trailing newline without duplicating it", () => {
    expect(
      applyEditorConfigOnSave("a   \nb   \n", { trimTrailingWhitespace: true }),
    ).toBe("a\nb\n");
  });

  it("trim-only preserves the file's existing CRLF endings", () => {
    expect(
      applyEditorConfigOnSave("a   \r\nb   \r\n", {
        trimTrailingWhitespace: true,
      }),
    ).toBe("a\r\nb\r\n");
  });

  it("does not strip interior blank lines while trimming", () => {
    expect(
      applyEditorConfigOnSave("a\n\nb\n", { trimTrailingWhitespace: true }),
    ).toBe("a\n\nb\n");
  });

  it("insert-final-newline alone preserves interior content and EOL", () => {
    expect(
      applyEditorConfigOnSave("a\r\nb", { insertFinalNewline: true }),
    ).toBe("a\r\nb\r\n");
  });
});
