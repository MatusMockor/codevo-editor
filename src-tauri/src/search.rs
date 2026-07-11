#[cfg(test)]
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(test)]
use std::fs;
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

/// One file changed by a Replace-in-Path run, with the number of replacements
/// applied inside it. The UI sums `replacements` across the list for its report
/// ("Replaced N occurrences in M files").
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(test)]
pub struct ReplaceInPathFileResult {
    pub path: String,
    pub relative_path: String,
    pub replacements: u64,
}

/// Aggregate outcome of a Replace-in-Path run: the changed files plus the total
/// replacement count. Files that matched but whose content was unchanged (e.g.
/// the replacement equals the matched text) are omitted so the report and any
/// downstream "reload these tabs" logic only sees real edits.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(test)]
pub struct ReplaceInPathResult {
    pub files: Vec<ReplaceInPathFileResult>,
    pub total_replacements: u64,
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

/// Replaces every match of `query` with `replacement` across the files under
/// `root` that match the same filters Find-in-Path uses. In regex mode,
/// `replacement` may reference capture groups (`$1`, `${name}`); in literal mode
/// the replacement is passed through `regex::NoExpand`, so every byte (including
/// `$` and `$$`) is inserted verbatim. Only the exact matched spans are rewritten
/// - the surrounding text (including the rest of each line) is preserved byte-for-byte.
///
/// `scope_path`, when `Some`, restricts the run to that single file (used by
/// "Replace in file"). It is matched exactly against the resolved path of each
/// candidate, so a user-supplied file mask cannot widen a single-file replace to
/// other files.
#[cfg(test)]
pub trait TextReplacer {
    fn replace(
        &self,
        root: &Path,
        query: &str,
        replacement: &str,
        options: &TextSearchOptions,
        scope_path: Option<&Path>,
    ) -> io::Result<ReplaceInPathResult>;
}

pub struct RipgrepTextSearcher;

#[cfg(test)]
pub struct RipgrepTextReplacer;

/// ripgrep exit code returned when the pattern itself is invalid (e.g. a
/// malformed user regex). We surface this as an empty result set rather than an
/// error so the UI shows "no matches" while the user is mid-typing a regex,
/// instead of flashing an error toast on every keystroke.
const RIPGREP_INVALID_PATTERN_EXIT_CODE: i32 = 2;

/// Hardcoded directories we never want in Find-in-Path results. Kept as
/// excludes (not overridable by the user mask) to avoid drowning matches in
/// vendored / generated code.
const DEFAULT_EXCLUDE_GLOBS: [&str; 6] = [
    "!.git",
    "!node_modules",
    "!vendor",
    "!target",
    "!dist",
    "!build",
];

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

    args.extend(build_ripgrep_filter_args(options));

    args
}

/// Builds the matching/filter flags shared by Find (`--json` search) and Replace
/// (`--files-with-matches` listing): literal-vs-regex, whole-word, case, default
/// excludes, and the user file mask. Keeping these in one place guarantees the
/// replace touches exactly the files the find would surface for the same options.
fn build_ripgrep_filter_args(options: &TextSearchOptions) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

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
impl TextReplacer for RipgrepTextReplacer {
    fn replace(
        &self,
        root: &Path,
        query: &str,
        replacement: &str,
        options: &TextSearchOptions,
        scope_path: Option<&Path>,
    ) -> io::Result<ReplaceInPathResult> {
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Search root is not a directory",
            ));
        }

        let trimmed_query = query.trim();

        if trimmed_query.is_empty() {
            return Ok(ReplaceInPathResult::default());
        }

        // Compile the same matcher ripgrep uses (case sensitivity, whole-word,
        // literal escaping, line-anchored `^`/`$`) so the set of replaced spans
        // is identical to the set of found spans. `replace_all` walks
        // left-to-right and rebuilds the string in one pass, so there is no
        // offset-shift bug when several matches share a line, and it is UTF-8
        // safe by construction (it never slices on a byte boundary). Capture
        // groups in `replacement` (`$1`, `${name}`) are honoured by the `regex`
        // crate.
        let matcher = build_replacement_regex(trimmed_query, options)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;

        // List EVERY file that matches AND passes every filter
        // (case/whole-word/regex/file-mask/gitignore/default excludes), with no
        // per-match cap, so a project-wide replace is never silently truncated.
        let candidate_paths = list_matching_files(root, trimmed_query, options)?;

        // For "Replace in file" the caller passes the exact file; resolve it once
        // so the comparison is canonical (symlinks / `..` cannot smuggle in a
        // different file, and a user file mask cannot widen the scope).
        let scope = scope_path.and_then(|path| path.canonicalize().ok());

        let mut files = Vec::new();
        let mut total_replacements: u64 = 0;

        for file_path in candidate_paths {
            // Path safety: never follow a result outside the requested root,
            // never rewrite a directory, and never rewrite (and thereby clobber)
            // a symlink - we replace file *contents*, not link targets.
            if !is_path_within_root(root, &file_path) || path_is_symlink(&file_path) {
                continue;
            }

            if file_path.is_dir() {
                continue;
            }

            if let Some(scope) = scope.as_ref() {
                let Ok(canonical) = file_path.canonicalize() else {
                    continue;
                };

                if &canonical != scope {
                    continue;
                }
            }

            let original = match fs::read_to_string(&file_path) {
                Ok(content) => content,
                // Skip binary / unreadable files rather than aborting the whole
                // run; ripgrep already filters most of these out.
                Err(_) => continue,
            };

            let replacement_count = matcher.find_iter(&original).count() as u64;

            if replacement_count == 0 {
                continue;
            }

            let updated = if options.is_regex {
                matcher.replace_all(&original, replacement)
            } else {
                matcher.replace_all(&original, regex::NoExpand(replacement))
            }
            .into_owned();

            if updated == original {
                continue;
            }

            // Atomic per file: stage the fully-rebuilt content in a temp file and
            // rename it over the target. A partial/failed write cannot leave a
            // file with only some replacements applied because we never write
            // incrementally and the rename is atomic on the same filesystem.
            write_file_atomically(&file_path, &updated)?;

            let relative_path = file_path
                .strip_prefix(root)
                .unwrap_or(&file_path)
                .to_string_lossy()
                .replace('\\', "/");

            total_replacements += replacement_count;
            files.push(ReplaceInPathFileResult {
                path: file_path.to_string_lossy().to_string(),
                relative_path,
                replacements: replacement_count,
            });
        }

        Ok(ReplaceInPathResult {
            files,
            total_replacements,
        })
    }
}

/// Lists every file under `root` containing at least one match for `query`,
/// honouring the same filters as Find-in-Path. Uses ripgrep `--files-with-matches`
/// (one path per line, no per-match cap) so a project-wide replace is never
/// truncated by the find-result limit. Returns absolute paths.
#[cfg(test)]
fn list_matching_files(
    root: &Path,
    query: &str,
    options: &TextSearchOptions,
) -> io::Result<Vec<PathBuf>> {
    let mut args = build_ripgrep_filter_args(options);
    args.push("--files-with-matches".to_string());

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
                    "ripgrep (rg) is not installed or not in PATH. Install ripgrep to use replace in files.",
                );
            }

            error
        })?;

    // Exit 2 = invalid pattern (e.g. mid-typed regex); fail soft with no files.
    if output.status.code() == Some(RIPGREP_INVALID_PATTERN_EXIT_CODE) {
        return Ok(Vec::new());
    }

    // Exit 1 = no matches; that is success with an empty list.
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(io::Error::other(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect())
}

/// True when `path` is itself a symlink (we must not replace a link with a
/// regular file). Uses `symlink_metadata` so the link is not followed.
#[cfg(test)]
fn path_is_symlink(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

/// Builds the `regex::Regex` whose matches line up exactly with what
/// Find-in-Path highlights for the same query + options:
/// - literal mode escapes every metacharacter (so `a.b` is literal);
/// - whole-word mode wraps the (escaped) query in a non-capturing `\b(?:..)\b`
///   so user capture-group numbering (`$1`, ...) is preserved;
/// - case sensitivity mirrors the `--ignore-case` / `--case-sensitive` flag;
/// - `multi_line` is enabled so `^`/`$` anchor to line boundaries, matching
///   ripgrep's per-line search semantics (otherwise a `^foo` regex would only
///   match at the very start of the file during replace).
///
/// In literal (non-regex) mode the query is escaped, so capture syntax in the
/// replacement only applies in regex mode, which is where capture groups are
/// expected.
#[cfg(test)]
fn build_replacement_regex(
    query: &str,
    options: &TextSearchOptions,
) -> Result<Regex, regex::Error> {
    let mut pattern = if options.is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    if options.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }

    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .multi_line(true)
        .build()
}

/// Returns true when `candidate` resolves to a path inside `root`. Both are
/// canonicalized so symlinks and `..` cannot smuggle a write outside the
/// workspace. If `candidate` cannot be canonicalized (e.g. it vanished between
/// the search and the write), it is rejected.
#[cfg(test)]
fn is_path_within_root(root: &Path, candidate: &Path) -> bool {
    let Ok(canonical_root) = root.canonicalize() else {
        return false;
    };

    let Ok(canonical_candidate) = candidate.canonicalize() else {
        return false;
    };

    canonical_candidate.starts_with(&canonical_root)
}

/// Writes `content` to `path` as atomically as the platform allows: write to a
/// sibling temp file, then rename over the target. The rename is atomic on the
/// same filesystem, so a reader never observes a half-written file, and a crash
/// mid-write leaves the original intact. Falls back to a direct write only if a
/// temp file cannot be created (e.g. a read-only directory), preserving the
/// previous behaviour rather than failing the whole run.
#[cfg(test)]
fn write_file_atomically(path: &Path, content: &str) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "replace".to_string());
    let temp_path = parent.join(format!(".{file_name}.codevo-replace.tmp"));

    let write_temp = fs::write(&temp_path, content.as_bytes());

    if write_temp.is_err() {
        // Could not stage a temp file; write directly so a legitimate replace
        // still lands. Still a single truncating write (no incremental edits).
        return fs::write(path, content.as_bytes());
    }

    match fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            let _ = fs::remove_file(&temp_path);
            Err(rename_error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_replacement_regex, build_ripgrep_args, parse_file_mask, parse_ripgrep_json_lines,
        RipgrepTextReplacer, RipgrepTextSearcher, TextReplacer, TextSearchOptions, TextSearcher,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_PROJECT_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Returns true when the `rg` (ripgrep) binary is invocable in the current
    /// PATH. Integration tests that spawn ripgrep use this to skip gracefully
    /// (instead of failing) on hosts without ripgrep installed (e.g. minimal CI
    /// images). Pure unit tests do not depend on it and always run.
    fn rg_available() -> bool {
        Command::new("rg")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    struct TempProject {
        path: PathBuf,
    }

    impl TempProject {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let counter = TEMP_PROJECT_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "mockor-editor-search-test-{}-{nanos}-{counter}",
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

    fn replace(
        project: &TempProject,
        query: &str,
        replacement: &str,
        options: TextSearchOptions,
    ) -> super::ReplaceInPathResult {
        RipgrepTextReplacer
            .replace(project.path(), query, replacement, &options, None)
            .expect("replace succeeds")
    }

    fn replace_scoped(
        project: &TempProject,
        query: &str,
        replacement: &str,
        options: TextSearchOptions,
        scope_path: &Path,
    ) -> super::ReplaceInPathResult {
        RipgrepTextReplacer
            .replace(
                project.path(),
                query,
                replacement,
                &options,
                Some(scope_path),
            )
            .expect("replace succeeds")
    }

    fn read(project: &TempProject, relative_path: &str) -> String {
        fs::read_to_string(project.path().join(relative_path)).expect("read file")
    }

    #[test]
    fn replace_rewrites_only_the_matched_span_not_the_whole_line() {
        if !rg_available() {
            eprintln!("skipping replace_rewrites_only_the_matched_span_not_the_whole_line: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "prefix needle suffix\n");

        let result = replace(&project, "needle", "thread", TextSearchOptions::default());

        // Only "needle" -> "thread"; the surrounding text is preserved exactly.
        assert_eq!(read(&project, "a.txt"), "prefix thread suffix\n");
        assert_eq!(result.total_replacements, 1);
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].relative_path, "a.txt");
        assert_eq!(result.files[0].replacements, 1);
    }

    #[test]
    fn replace_all_changes_many_files_and_counts_replacements() {
        if !rg_available() {
            eprintln!("skipping replace_all_changes_many_files_and_counts_replacements: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("one.txt", "foo here\n");
        project.write("two.txt", "and foo again\n");
        project.write("nested/three.txt", "foo foo\n");
        project.write("untouched.txt", "nothing relevant\n");

        let result = replace(&project, "foo", "bar", TextSearchOptions::default());

        assert_eq!(read(&project, "one.txt"), "bar here\n");
        assert_eq!(read(&project, "two.txt"), "and bar again\n");
        assert_eq!(read(&project, "nested/three.txt"), "bar bar\n");
        assert_eq!(read(&project, "untouched.txt"), "nothing relevant\n");
        assert_eq!(result.files.len(), 3);
        // 1 + 1 + 2 = 4 occurrences across the three files.
        assert_eq!(result.total_replacements, 4);
    }

    #[test]
    fn replace_multiple_matches_on_one_line_has_no_offset_shift() {
        if !rg_available() {
            eprintln!("skipping replace_multiple_matches_on_one_line_has_no_offset_shift: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        // The replacement is LONGER than the match, which is exactly where a
        // naive incremental byte-offset edit would corrupt later matches.
        project.write("a.txt", "x x x x\n");

        let result = replace(&project, "x", "yyy", TextSearchOptions::default());

        assert_eq!(read(&project, "a.txt"), "yyy yyy yyy yyy\n");
        assert_eq!(result.total_replacements, 4);
    }

    #[test]
    fn replace_regex_capture_groups_are_substituted() {
        if !rg_available() {
            eprintln!(
                "skipping replace_regex_capture_groups_are_substituted: ripgrep (rg) not in PATH"
            );
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "name=Alice\nname=Bob\n");

        let result = replace(
            &project,
            r"name=(\w+)",
            "user:$1",
            TextSearchOptions {
                is_regex: true,
                ..Default::default()
            },
        );

        assert_eq!(read(&project, "a.txt"), "user:Alice\nuser:Bob\n");
        assert_eq!(result.total_replacements, 2);
    }

    #[test]
    fn replace_is_multibyte_safe() {
        if !rg_available() {
            eprintln!("skipping replace_is_multibyte_safe: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        // Multi-byte chars before and inside the match; a byte-offset bug would
        // slice mid-character and corrupt the file.
        project.write("a.txt", "café — naïve needle café\n");

        let result = replace(&project, "needle", "thread", TextSearchOptions::default());

        assert_eq!(read(&project, "a.txt"), "café — naïve thread café\n");
        assert_eq!(result.total_replacements, 1);
    }

    #[test]
    fn replace_literal_does_not_treat_query_as_regex() {
        if !rg_available() {
            eprintln!(
                "skipping replace_literal_does_not_treat_query_as_regex: ripgrep (rg) not in PATH"
            );
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "a.b and axb\n");

        // Literal "a.b" must NOT match "axb"; only the exact "a.b".
        let result = replace(&project, "a.b", "Z", TextSearchOptions::default());

        assert_eq!(read(&project, "a.txt"), "Z and axb\n");
        assert_eq!(result.total_replacements, 1);
    }

    #[test]
    fn replace_literal_preserves_dollar_replacement_verbatim() {
        if !rg_available() {
            eprintln!(
                "skipping replace_literal_preserves_dollar_replacement_verbatim: ripgrep (rg) not in PATH"
            );
            return;
        }
        let project = TempProject::new();
        project.write("a.php", "x x\n");

        let result = replace(
            &project,
            "x",
            "$user = 5 / $100",
            TextSearchOptions::default(),
        );

        assert_eq!(
            read(&project, "a.php"),
            "$user = 5 / $100 $user = 5 / $100\n"
        );
        assert_eq!(result.total_replacements, 2);
    }

    #[test]
    fn replace_respects_case_sensitivity() {
        if !rg_available() {
            eprintln!("skipping replace_respects_case_sensitivity: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "Foo foo FOO\n");

        let result = replace(
            &project,
            "foo",
            "bar",
            TextSearchOptions {
                case_sensitive: true,
                ..Default::default()
            },
        );

        // Only the exact-case "foo" is replaced.
        assert_eq!(read(&project, "a.txt"), "Foo bar FOO\n");
        assert_eq!(result.total_replacements, 1);
    }

    #[test]
    fn replace_respects_whole_word() {
        if !rg_available() {
            eprintln!("skipping replace_respects_whole_word: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "user username the user\n");

        let result = replace(
            &project,
            "user",
            "X",
            TextSearchOptions {
                whole_word: true,
                ..Default::default()
            },
        );

        // "username" must be left intact; only standalone "user" tokens change.
        assert_eq!(read(&project, "a.txt"), "X username the X\n");
        assert_eq!(result.total_replacements, 2);
    }

    #[test]
    fn replace_respects_file_mask() {
        if !rg_available() {
            eprintln!("skipping replace_respects_file_mask: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.php", "needle\n");
        project.write("b.txt", "needle\n");

        let result = replace(
            &project,
            "needle",
            "thread",
            TextSearchOptions {
                file_mask: Some("*.php".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(read(&project, "a.php"), "thread\n");
        // The .txt file is outside the mask and must be untouched.
        assert_eq!(read(&project, "b.txt"), "needle\n");
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].relative_path, "a.php");
    }

    #[test]
    fn replace_scoped_to_single_file_ignores_other_matching_files() {
        if !rg_available() {
            eprintln!("skipping replace_scoped_to_single_file_ignores_other_matching_files: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.php", "needle\n");
        project.write("b.php", "needle\n");

        let scope = project.path().join("a.php");
        let result = replace_scoped(
            &project,
            "needle",
            "thread",
            TextSearchOptions::default(),
            &scope,
        );

        // Only the scoped file changes; the other matching file is untouched.
        assert_eq!(read(&project, "a.php"), "thread\n");
        assert_eq!(read(&project, "b.php"), "needle\n");
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].relative_path, "a.php");
    }

    #[test]
    fn replace_scoped_does_not_widen_with_an_active_file_mask() {
        if !rg_available() {
            eprintln!("skipping replace_scoped_does_not_widen_with_an_active_file_mask: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.php", "needle\n");
        project.write("b.php", "needle\n");

        // A wide include mask (*.php) plus a single-file scope must NOT replace
        // b.php - the scope wins. This is the scope-escape regression guard.
        let scope = project.path().join("a.php");
        let result = replace_scoped(
            &project,
            "needle",
            "thread",
            TextSearchOptions {
                file_mask: Some("*.php".to_string()),
                ..Default::default()
            },
            &scope,
        );

        assert_eq!(read(&project, "a.php"), "thread\n");
        assert_eq!(read(&project, "b.php"), "needle\n");
        assert_eq!(result.files.len(), 1);
    }

    #[test]
    fn replace_regex_anchors_match_per_line_like_find() {
        if !rg_available() {
            eprintln!(
                "skipping replace_regex_anchors_match_per_line_like_find: ripgrep (rg) not in PATH"
            );
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "foo\nbar\nfoo\n");

        // `^foo` must match the start of EVERY line (ripgrep per-line semantics),
        // not only the very start of the file.
        let result = replace(
            &project,
            "^foo",
            "X",
            TextSearchOptions {
                is_regex: true,
                ..Default::default()
            },
        );

        assert_eq!(read(&project, "a.txt"), "X\nbar\nX\n");
        assert_eq!(result.total_replacements, 2);
    }

    #[test]
    fn replace_does_not_replace_across_more_than_500_matches_silently() {
        if !rg_available() {
            eprintln!("skipping replace_does_not_replace_across_more_than_500_matches_silently: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        // 600 distinct files, each with one match: this exceeds the 500-result
        // find cap, so a find-based replace would silently miss ~100 files.
        for index in 0..600 {
            project.write(&format!("file_{index}.txt"), "needle\n");
        }

        let result = replace(&project, "needle", "thread", TextSearchOptions::default());

        assert_eq!(result.files.len(), 600);
        assert_eq!(result.total_replacements, 600);
    }

    #[test]
    fn replace_empty_query_is_a_noop() {
        let project = TempProject::new();
        project.write("a.txt", "content\n");

        let result = replace(&project, "   ", "x", TextSearchOptions::default());

        assert_eq!(read(&project, "a.txt"), "content\n");
        assert_eq!(result.total_replacements, 0);
        assert!(result.files.is_empty());
    }

    #[test]
    fn replace_same_text_does_not_rewrite_file() {
        if !rg_available() {
            eprintln!("skipping replace_same_text_does_not_rewrite_file: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "needle\n");

        // Replacing a literal with itself changes nothing, so no file is reported.
        let result = replace(&project, "needle", "needle", TextSearchOptions::default());

        assert_eq!(read(&project, "a.txt"), "needle\n");
        assert!(result.files.is_empty());
        assert_eq!(result.total_replacements, 0);
    }

    #[test]
    fn build_replacement_regex_literal_escapes_metacharacters() {
        let regex =
            build_replacement_regex("a.b", &TextSearchOptions::default()).expect("valid regex");

        assert!(regex.is_match("a.b"));
        assert!(!regex.is_match("axb"));
    }

    #[test]
    fn build_replacement_regex_whole_word_wraps_boundaries() {
        let regex = build_replacement_regex(
            "user",
            &TextSearchOptions {
                whole_word: true,
                ..Default::default()
            },
        )
        .expect("valid regex");

        assert!(regex.is_match("the user here"));
        assert!(!regex.is_match("username"));
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
        if !rg_available() {
            eprintln!(
                "skipping default_search_is_case_insensitive_literal: ripgrep (rg) not in PATH"
            );
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "Hello World\n");

        let results = search(&project, "hello", TextSearchOptions::default());

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_text, "Hello World");
    }

    #[test]
    fn case_sensitive_excludes_other_casings() {
        if !rg_available() {
            eprintln!("skipping case_sensitive_excludes_other_casings: ripgrep (rg) not in PATH");
            return;
        }
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
        if !rg_available() {
            eprintln!(
                "skipping whole_word_matches_only_standalone_token: ripgrep (rg) not in PATH"
            );
            return;
        }
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
        if !rg_available() {
            eprintln!("skipping literal_query_does_not_treat_special_chars_as_regex: ripgrep (rg) not in PATH");
            return;
        }
        let project = TempProject::new();
        project.write("a.txt", "a.b\naxb\n");

        let results = search(&project, "a.b", TextSearchOptions::default());

        // Literal "a.b" must NOT match "axb"; only the exact "a.b" line.
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, 1);
    }

    #[test]
    fn regex_query_matches_pattern() {
        if !rg_available() {
            eprintln!("skipping regex_query_matches_pattern: ripgrep (rg) not in PATH");
            return;
        }
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
        if !rg_available() {
            eprintln!("skipping invalid_regex_returns_empty_not_error: ripgrep (rg) not in PATH");
            return;
        }
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
        if !rg_available() {
            eprintln!(
                "skipping file_mask_include_restricts_to_matching_files: ripgrep (rg) not in PATH"
            );
            return;
        }
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
        if !rg_available() {
            eprintln!("skipping file_mask_exclude_drops_matching_files: ripgrep (rg) not in PATH");
            return;
        }
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
