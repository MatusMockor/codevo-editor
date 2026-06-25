use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSearchResult {
    pub path: String,
    pub relative_path: String,
    pub line_number: u64,
    pub column: u64,
    pub line_text: String,
    /// 0-based char offset of the match start within `line_text`. Lets the UI
    /// highlight the exact matched span instead of re-running the query in JS.
    pub match_start: u64,
    /// 0-based char offset of the match end (exclusive) within `line_text`.
    pub match_end: u64,
}

/// Filters that shape a Find-in-Path query. Defaults (all `false` / `None`)
/// reproduce the original literal, case-insensitive, unfiltered search so the
/// existing call sites keep working unchanged.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TextSearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub is_regex: bool,
    /// Comma- or newline-separated glob list. A leading `!` excludes. Examples:
    /// `*.php`, `app/**`, `!vendor`, `*.php,!**/migrations/**`.
    pub file_mask: Option<String>,
}

pub trait TextSearcher {
    fn search(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
        options: &TextSearchOptions,
    ) -> io::Result<Vec<TextSearchResult>>;
}

pub struct RipgrepTextSearcher;

/// ripgrep exit code returned when the pattern itself is invalid (e.g. a
/// malformed user regex). We surface this as an empty result set rather than an
/// error so the UI shows "no matches" while the user is mid-typing a regex,
/// instead of flashing an error toast on every keystroke.
const RIPGREP_INVALID_PATTERN_EXIT_CODE: i32 = 2;

/// Hardcoded directories we never want in Find-in-Path results. Kept as
/// excludes (not overridable by the user mask) to avoid drowning matches in
/// vendored / generated code.
const DEFAULT_EXCLUDE_GLOBS: [&str; 6] =
    ["!.git", "!node_modules", "!vendor", "!target", "!dist", "!build"];

impl TextSearcher for RipgrepTextSearcher {
    fn search(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
        options: &TextSearchOptions,
    ) -> io::Result<Vec<TextSearchResult>> {
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Search root is not a directory",
            ));
        }

        let query = query.trim();

        if query.is_empty() {
            return Ok(Vec::new());
        }

        let args = build_ripgrep_args(query, options);

        let output = Command::new("rg")
            .args(&args)
            .arg("--")
            .arg(query)
            .arg(root)
            .output()
            .map_err(|error| {
                if error.kind() == io::ErrorKind::NotFound {
                    return io::Error::new(
                        io::ErrorKind::NotFound,
                        "ripgrep (rg) is not installed or not in PATH. Install ripgrep to use text search.",
                    );
                }

                error
            })?;

        // Exit 0 = matches, 1 = no matches: both are success for us.
        if output.status.code() == Some(RIPGREP_INVALID_PATTERN_EXIT_CODE) {
            // Invalid pattern (e.g. malformed regex). Fail soft with no results.
            return Ok(Vec::new());
        }

        if !output.status.success() && output.status.code() != Some(1) {
            return Err(io::Error::other(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        parse_ripgrep_json_lines(root, &String::from_utf8_lossy(&output.stdout), limit)
    }
}

/// Builds the ripgrep flag list (everything before the `--` separator) for the
/// given query + filters. Pure and side-effect free so it can be unit-tested
/// without spawning a process.
///
/// Safety: every dynamic value (the query, the file mask) is passed to ripgrep
/// as a separate argv entry, never interpolated into a shell string, so it
/// cannot inject flags or shell metacharacters. The query is additionally
/// guarded by the `--` end-of-flags marker added by the caller. ripgrep's regex
/// engine is the Rust `regex` crate, which has linear-time matching (no
/// catastrophic backtracking), so a user-supplied regex cannot trigger ReDoS.
fn build_ripgrep_args(_query: &str, options: &TextSearchOptions) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--json".to_string(),
        "--line-number".to_string(),
        "--column".to_string(),
        "--color".to_string(),
        "never".to_string(),
    ];

    if !options.is_regex {
        // Treat the query as a literal string, not a regex.
        args.push("--fixed-strings".to_string());
    }

    if options.whole_word {
        args.push("--word-regexp".to_string());
    }

    let case_flag = if options.case_sensitive {
        "--case-sensitive"
    } else {
        "--ignore-case"
    };
    args.push(case_flag.to_string());

    for glob in DEFAULT_EXCLUDE_GLOBS {
        args.push("--glob".to_string());
        args.push(glob.to_string());
    }

    for glob in parse_file_mask(options.file_mask.as_deref()) {
        args.push("--glob".to_string());
        args.push(glob);
    }

    args
}

/// Splits a user file mask into individual ripgrep globs. Accepts comma- or
/// newline-separated entries, trims whitespace, and drops empty tokens. A
/// leading `!` (exclude) is preserved as ripgrep already understands it.
fn parse_file_mask(mask: Option<&str>) -> Vec<String> {
    let Some(mask) = mask else {
        return Vec::new();
    };

    mask.split(['\n', ','])
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_ripgrep_json_lines(
    root: &Path,
    output: &str,
    limit: usize,
) -> io::Result<Vec<TextSearchResult>> {
    let mut results = Vec::new();
    let capped_limit = limit.clamp(1, 500);

    for line in output.lines() {
        if results.len() >= capped_limit {
            return Ok(results);
        }

        let value: Value = serde_json::from_str(line).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Invalid ripgrep JSON: {error}"),
            )
        })?;

        if value.get("type").and_then(Value::as_str) != Some("match") {
            continue;
        }

        let Some(data) = value.get("data") else {
            continue;
        };

        let Some(path) = data
            .get("path")
            .and_then(|path| path.get("text"))
            .and_then(Value::as_str)
        else {
            continue;
        };

        let line_number = data.get("line_number").and_then(Value::as_u64).unwrap_or(1);
        let line_text = data
            .get("lines")
            .and_then(|lines| lines.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim_end_matches(['\r', '\n'])
            .to_string();

        let first_submatch = data
            .get("submatches")
            .and_then(Value::as_array)
            .and_then(|submatches| submatches.first());

        // ripgrep reports byte offsets within the line; convert to char offsets
        // so the UI can slice the (UTF-8) string safely for highlighting.
        let byte_start = first_submatch
            .and_then(|submatch| submatch.get("start"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let byte_end = first_submatch
            .and_then(|submatch| submatch.get("end"))
            .and_then(Value::as_u64)
            .unwrap_or(byte_start);

        let match_start = byte_offset_to_char_offset(&line_text, byte_start);
        let match_end = byte_offset_to_char_offset(&line_text, byte_end);
        let column = match_start + 1;

        let path = PathBuf::from(path);
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        results.push(TextSearchResult {
            column,
            line_number,
            line_text,
            match_start,
            match_end,
            path: path.to_string_lossy().to_string(),
            relative_path,
        });
    }

    Ok(results)
}

/// Maps a byte offset into a line to the corresponding char offset. ripgrep
/// emits byte offsets, but the front-end indexes JS strings by char (UTF-16
/// code unit boundaries align with chars for the BMP); using char offsets keeps
/// multi-byte matches from highlighting the wrong span.
fn byte_offset_to_char_offset(line: &str, byte_offset: u64) -> u64 {
    let byte_offset = byte_offset as usize;

    if byte_offset >= line.len() {
        return line.chars().count() as u64;
    }

    line[..byte_offset].chars().count() as u64
}

#[cfg(test)]
mod tests {
    use super::{
        build_ripgrep_args, parse_file_mask, parse_ripgrep_json_lines, RipgrepTextSearcher,
        TextSearchOptions, TextSearcher,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempProject {
        path: PathBuf,
    }

    impl TempProject {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mockor-editor-search-test-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp project");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn write(&self, relative_path: &str, content: &str) {
            let full = self.path.join(relative_path);
            if let Some(parent) = full.parent() {
                fs::create_dir_all(parent).expect("create parent dirs");
            }
            fs::write(full, content).expect("write file");
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn search(
        project: &TempProject,
        query: &str,
        options: TextSearchOptions,
    ) -> Vec<super::TextSearchResult> {
        RipgrepTextSearcher
            .search(project.path(), query, 100, &options)
            .expect("search succeeds")
    }

    #[test]
    fn parses_match_events_from_ripgrep_json() {
        let output = r#"{"type":"begin","data":{"path":{"text":"/tmp/project/src/User.php"}}}
{"type":"match","data":{"path":{"text":"/tmp/project/src/User.php"},"lines":{"text":"final class User\n"},"line_number":4,"absolute_offset":36,"submatches":[{"match":{"text":"User"},"start":12,"end":16}]}}
{"type":"end","data":{"path":{"text":"/tmp/project/src/User.php"},"binary_offset":null,"stats":{"elapsed":{"secs":0,"nanos":1,"human":"0.000000001s"},"searches":1,"searches_with_match":1,"bytes_searched":52,"bytes_printed":100,"matched_lines":1,"matches":1}}}"#;

        let results =
            parse_ripgrep_json_lines(Path::new("/tmp/project"), output, 20).expect("parse output");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "src/User.php");
        assert_eq!(results[0].line_number, 4);
        assert_eq!(results[0].column, 13);
        assert_eq!(results[0].line_text, "final class User");
        assert_eq!(results[0].match_start, 12);
        assert_eq!(results[0].match_end, 16);
    }

    #[test]
    fn default_search_is_case_insensitive_literal() {
        let project = TempProject::new();
        project.write("a.txt", "Hello World\n");

        let results = search(&project, "hello", TextSearchOptions::default());

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_text, "Hello World");
    }

    #[test]
    fn case_sensitive_excludes_other_casings() {
        let project = TempProject::new();
        project.write("a.txt", "Hello\nhello\nHELLO\n");

        let results = search(
            &project,
            "hello",
            TextSearchOptions {
                case_sensitive: true,
                ..Default::default()
            },
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, 2);
    }

    #[test]
    fn whole_word_matches_only_standalone_token() {
        let project = TempProject::new();
        project.write("a.txt", "user\nusername\nthe user here\n");

        let results = search(
            &project,
            "user",
            TextSearchOptions {
                whole_word: true,
                ..Default::default()
            },
        );

        let lines: Vec<u64> = results.iter().map(|r| r.line_number).collect();
        assert_eq!(lines, vec![1, 3]);
    }

    #[test]
    fn literal_query_does_not_treat_special_chars_as_regex() {
        let project = TempProject::new();
        project.write("a.txt", "a.b\naxb\n");

        let results = search(&project, "a.b", TextSearchOptions::default());

        // Literal "a.b" must NOT match "axb"; only the exact "a.b" line.
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, 1);
    }

    #[test]
    fn regex_query_matches_pattern() {
        let project = TempProject::new();
        project.write("a.txt", "foo123\nfooXYZ\n");

        let results = search(
            &project,
            r"foo\d+",
            TextSearchOptions {
                is_regex: true,
                ..Default::default()
            },
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, 1);
    }

    #[test]
    fn invalid_regex_returns_empty_not_error() {
        let project = TempProject::new();
        project.write("a.txt", "anything\n");

        // Unbalanced paren is an invalid regex; must fail soft (empty), not crash.
        let results = RipgrepTextSearcher
            .search(
                project.path(),
                "foo(",
                100,
                &TextSearchOptions {
                    is_regex: true,
                    ..Default::default()
                },
            )
            .expect("invalid regex must not error");

        assert!(results.is_empty());
    }

    #[test]
    fn file_mask_include_restricts_to_matching_files() {
        let project = TempProject::new();
        project.write("a.php", "needle\n");
        project.write("b.txt", "needle\n");

        let results = search(
            &project,
            "needle",
            TextSearchOptions {
                file_mask: Some("*.php".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "a.php");
    }

    #[test]
    fn file_mask_exclude_drops_matching_files() {
        let project = TempProject::new();
        project.write("keep.php", "needle\n");
        project.write("skip.test.php", "needle\n");

        let results = search(
            &project,
            "needle",
            TextSearchOptions {
                file_mask: Some("!*.test.php".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "keep.php");
    }

    #[test]
    fn empty_query_returns_no_results() {
        let project = TempProject::new();
        project.write("a.txt", "content\n");

        let results = search(&project, "   ", TextSearchOptions::default());

        assert!(results.is_empty());
    }

    #[test]
    fn build_args_default_uses_fixed_strings_and_ignore_case() {
        let args = build_ripgrep_args("query", &TextSearchOptions::default());

        assert!(args.iter().any(|a| a == "--fixed-strings"));
        assert!(args.iter().any(|a| a == "--ignore-case"));
        assert!(!args.iter().any(|a| a == "--word-regexp"));
        assert!(!args.iter().any(|a| a == "--case-sensitive"));
    }

    #[test]
    fn build_args_regex_omits_fixed_strings() {
        let args = build_ripgrep_args(
            "query",
            &TextSearchOptions {
                is_regex: true,
                ..Default::default()
            },
        );

        assert!(!args.iter().any(|a| a == "--fixed-strings"));
    }

    #[test]
    fn build_args_includes_default_excludes() {
        let args = build_ripgrep_args("query", &TextSearchOptions::default());

        assert!(args.iter().any(|a| a == "!vendor"));
        assert!(args.iter().any(|a| a == "!node_modules"));
    }

    #[test]
    fn parse_file_mask_splits_and_trims() {
        let masks = parse_file_mask(Some(" *.php , !vendor \n app/** "));

        assert_eq!(masks, vec!["*.php", "!vendor", "app/**"]);
    }

    #[test]
    fn parse_file_mask_none_is_empty() {
        assert!(parse_file_mask(None).is_empty());
    }
}
