//! Bounded, line-oriented problem matching for typed Node package tasks.
//!
//! This module is deliberately independent of Tauri and the task registry. The integration layer
//! must construct it from the descriptor-derived workspace/package identities and attach the
//! resulting events to an already-authorized task owner.

use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    path::{Component, Path, PathBuf},
};

use crate::workspace_registry::{
    open_file_relative_to, opened_regular_file_path, opened_root_path,
};

pub(crate) const MAX_TASK_PROBLEM_LINE_BYTES: usize = 16 * 1024;
pub(crate) const MAX_TASK_PROBLEM_MESSAGE_BYTES: usize = 2 * 1024;
pub(crate) const MAX_TASK_PROBLEM_CODE_BYTES: usize = 128;
pub(crate) const MAX_TASK_PROBLEM_PATH_BYTES: usize = 4 * 1024;
pub(crate) const MAX_TASK_PROBLEM_SCANNED_LINES: u64 = 100_000;
pub(crate) const MAX_TASK_PROBLEMS: usize = 256;
pub(crate) const MAX_TASK_PROBLEMS_PER_FILE: usize = 64;
pub(crate) const MAX_TASK_PROBLEM_BATCH: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodePackageProblemMatcherKind {
    TypeScript,
    EslintStylish,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodePackageTaskOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodePackageProblemSeverity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodePackageProblemSource {
    TypeScript,
    Eslint,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NodePackageProblem {
    pub(crate) code: Option<String>,
    pub(crate) column: u32,
    pub(crate) file_path: String,
    pub(crate) line_number: u32,
    pub(crate) message: String,
    pub(crate) severity: NodePackageProblemSeverity,
    pub(crate) source: NodePackageProblemSource,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NodePackageProblemSnapshot {
    pub(crate) problems: Vec<NodePackageProblem>,
    pub(crate) scanned_lines: u64,
    pub(crate) total: u64,
    pub(crate) truncated: bool,
}

pub(crate) struct NodePackageProblemMatcher {
    kind: NodePackageProblemMatcherKind,
    package_directory: File,
    package_path: PathBuf,
    package_relative_path: PathBuf,
    pending: VecDeque<NodePackageProblem>,
    per_file: HashMap<String, usize>,
    problems: Vec<NodePackageProblem>,
    scanned_lines: u64,
    stderr: StreamState,
    stdout: StreamState,
    total: u64,
    truncated: bool,
    workspace_path: PathBuf,
    workspace_root: File,
}

impl NodePackageProblemMatcher {
    /// `package_cwd` must be the path obtained from the descriptor-bound package directory used
    /// to spawn the task. Both identities are canonicalized again and confined before matching.
    pub(crate) fn new(
        kind: NodePackageProblemMatcherKind,
        workspace_root: &File,
        workspace_path: &Path,
        package_directory: &File,
        package_path: &Path,
    ) -> Result<Self, String> {
        if !workspace_path.is_absolute() || !package_path.is_absolute() {
            return Err("Task problem descriptor paths must be absolute.".to_string());
        }
        let package_relative_path = package_path
            .strip_prefix(workspace_path)
            .ok()
            .and_then(|path| normalize_relative(Path::new(""), path))
            .ok_or_else(|| {
                "Task problem working directory is outside the workspace.".to_string()
            })?;
        let workspace_root = workspace_root
            .try_clone()
            .map_err(|error| format!("Failed to retain task problem workspace: {error}"))?;
        let package_directory = package_directory
            .try_clone()
            .map_err(|error| format!("Failed to retain task problem working directory: {error}"))?;
        if opened_root_path(&workspace_root).ok().as_deref() != Some(workspace_path)
            || opened_root_path(&package_directory).ok().as_deref() != Some(package_path)
        {
            return Err("Task problem working directory is outside the workspace.".to_string());
        }
        Ok(Self {
            kind,
            package_directory,
            package_path: package_path.to_path_buf(),
            package_relative_path,
            pending: VecDeque::new(),
            per_file: HashMap::new(),
            problems: Vec::new(),
            scanned_lines: 0,
            stderr: StreamState::default(),
            stdout: StreamState::default(),
            total: 0,
            truncated: false,
            workspace_path: workspace_path.to_path_buf(),
            workspace_root,
        })
    }

    pub(crate) fn push_bytes(
        &mut self,
        stream: NodePackageTaskOutputStream,
        bytes: &[u8],
    ) -> Vec<NodePackageProblem> {
        let lines = self.stream_mut(stream).push(bytes);
        self.process_lines(stream, lines);
        self.drain_batch()
    }

    pub(crate) fn finish_stream(
        &mut self,
        stream: NodePackageTaskOutputStream,
    ) -> Vec<NodePackageProblem> {
        let line = self.stream_mut(stream).finish();
        if let Some(line) = line {
            self.process_lines(stream, vec![line]);
        }
        self.drain_batch()
    }

    pub(crate) fn drain_batch(&mut self) -> Vec<NodePackageProblem> {
        let count = self.pending.len().min(MAX_TASK_PROBLEM_BATCH);
        self.pending.drain(..count).collect()
    }

    pub(crate) fn snapshot(&self) -> NodePackageProblemSnapshot {
        NodePackageProblemSnapshot {
            problems: self.problems.clone(),
            scanned_lines: self.scanned_lines,
            total: self.total,
            truncated: self.truncated || self.stdout.truncated || self.stderr.truncated,
        }
    }

    fn stream_mut(&mut self, stream: NodePackageTaskOutputStream) -> &mut StreamState {
        match stream {
            NodePackageTaskOutputStream::Stdout => &mut self.stdout,
            NodePackageTaskOutputStream::Stderr => &mut self.stderr,
        }
    }

    fn process_lines(&mut self, stream: NodePackageTaskOutputStream, lines: Vec<Vec<u8>>) {
        for bytes in lines {
            if self.scanned_lines >= MAX_TASK_PROBLEM_SCANNED_LINES {
                self.truncated = true;
                continue;
            }
            self.scanned_lines += 1;
            let line = String::from_utf8_lossy(&bytes);
            let parsed = match self.kind {
                NodePackageProblemMatcherKind::TypeScript => parse_typescript_line(&line),
                NodePackageProblemMatcherKind::EslintStylish => {
                    self.parse_eslint_line(stream, &line)
                }
            };
            let Some(candidate) = parsed else {
                continue;
            };
            let Some(problem) = self.resolve(candidate) else {
                continue;
            };
            self.total = self.total.saturating_add(1);
            let file_count = self.per_file.entry(problem.file_path.clone()).or_default();
            if self.problems.len() >= MAX_TASK_PROBLEMS || *file_count >= MAX_TASK_PROBLEMS_PER_FILE
            {
                self.truncated = true;
                continue;
            }
            *file_count += 1;
            self.pending.push_back(problem.clone());
            self.problems.push(problem);
        }
    }

    fn parse_eslint_line(
        &mut self,
        stream: NodePackageTaskOutputStream,
        line: &str,
    ) -> Option<ProblemCandidate> {
        if let Some(candidate) = parse_eslint_diagnostic(line) {
            let file = self.stream_mut(stream).eslint_file.clone()?;
            return Some(ProblemCandidate {
                path: file.to_string_lossy().into_owned(),
                ..candidate
            });
        }
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && trimmed.len() == line.len()
            && looks_like_supported_source(trimmed)
        {
            self.stream_mut(stream).eslint_file = self.resolve_path(trimmed);
        }
        None
    }

    fn resolve(&mut self, mut candidate: ProblemCandidate) -> Option<NodePackageProblem> {
        if candidate.path.len() > MAX_TASK_PROBLEM_PATH_BYTES
            || candidate.path.chars().any(char::is_control)
            || candidate.path.contains("://")
        {
            self.truncated = true;
            return None;
        }
        let path = self.resolve_path(&candidate.path)?;
        let file_path = path.to_str()?.to_string();
        if file_path.len() > MAX_TASK_PROBLEM_PATH_BYTES {
            self.truncated = true;
            return None;
        }
        if candidate
            .message
            .chars()
            .any(|character| character.is_control() && character != '\t')
        {
            return None;
        }
        if candidate.message.len() > MAX_TASK_PROBLEM_MESSAGE_BYTES {
            self.truncated = true;
        }
        candidate.message = truncate_utf8(&candidate.message, MAX_TASK_PROBLEM_MESSAGE_BYTES);
        if candidate.message.is_empty() {
            return None;
        }
        let code = match candidate.code {
            Some(code)
                if code.len() <= MAX_TASK_PROBLEM_CODE_BYTES
                    && !code.chars().any(char::is_control) =>
            {
                Some(code)
            }
            Some(_) => {
                self.truncated = true;
                None
            }
            None => None,
        };
        Some(NodePackageProblem {
            code,
            column: candidate.column,
            file_path,
            line_number: candidate.line_number,
            message: candidate.message,
            severity: candidate.severity,
            source: candidate.source,
        })
    }

    fn resolve_path(&self, value: &str) -> Option<PathBuf> {
        if value.is_empty()
            || value.len() > MAX_TASK_PROBLEM_PATH_BYTES
            || value.chars().any(char::is_control)
            || value.contains("://")
        {
            return None;
        }
        let input = Path::new(value);
        let relative = if input.is_absolute() {
            normalize_relative(
                Path::new(""),
                input.strip_prefix(&self.workspace_path).ok()?,
            )?
        } else {
            normalize_relative(&self.package_relative_path, input)?
        };
        if !is_supported_source_path(&relative) || !self.descriptor_identities_are_current() {
            return None;
        }
        let file = open_file_relative_to(&self.workspace_root, &relative).ok()?;
        let opened_path = opened_regular_file_path(&file).ok()?;
        let expected_path = self.workspace_path.join(&relative);
        if opened_path != expected_path || !self.descriptor_identities_are_current() {
            return None;
        }
        Some(opened_path)
    }

    fn descriptor_identities_are_current(&self) -> bool {
        opened_root_path(&self.workspace_root).ok().as_deref()
            == Some(self.workspace_path.as_path())
            && opened_root_path(&self.package_directory).ok().as_deref()
                == Some(self.package_path.as_path())
    }
}

fn normalize_relative(base: &Path, input: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in base.components().chain(input.components()) {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Prefix(_) | Component::RootDir => return None,
        }
    }
    Some(normalized)
}

#[derive(Default)]
struct StreamState {
    ansi: AnsiStripper,
    buffer: Vec<u8>,
    discard_line: bool,
    eslint_file: Option<PathBuf>,
    previous_was_cr: bool,
    truncated: bool,
}

impl StreamState {
    fn push(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut lines = Vec::new();
        for raw_byte in bytes.iter().copied() {
            let Some(byte) = self.ansi.feed(raw_byte) else {
                continue;
            };
            match byte {
                b'\n' if self.previous_was_cr => self.previous_was_cr = false,
                b'\n' => self.finish_line(&mut lines),
                b'\r' => {
                    self.finish_line(&mut lines);
                    self.previous_was_cr = true;
                }
                byte => {
                    self.previous_was_cr = false;
                    if byte.is_ascii_control() && byte != b'\t' {
                        self.buffer.clear();
                        self.discard_line = true;
                        self.truncated = true;
                        continue;
                    }
                    if self.discard_line {
                        continue;
                    }
                    if self.buffer.len() == MAX_TASK_PROBLEM_LINE_BYTES {
                        self.buffer.clear();
                        self.discard_line = true;
                        self.truncated = true;
                    } else {
                        self.buffer.push(byte);
                    }
                }
            }
        }
        lines
    }

    fn finish(&mut self) -> Option<Vec<u8>> {
        self.previous_was_cr = false;
        if self.discard_line {
            self.discard_line = false;
            return None;
        }
        (!self.buffer.is_empty()).then(|| std::mem::take(&mut self.buffer))
    }

    fn finish_line(&mut self, lines: &mut Vec<Vec<u8>>) {
        if self.discard_line {
            self.discard_line = false;
            self.buffer.clear();
        } else {
            lines.push(std::mem::take(&mut self.buffer));
        }
    }
}

#[derive(Clone, Copy, Default)]
enum AnsiState {
    #[default]
    Ground,
    Escape,
    Csi,
    Osc,
    OscEscape,
}

#[derive(Default)]
struct AnsiStripper {
    state: AnsiState,
}

impl AnsiStripper {
    fn feed(&mut self, byte: u8) -> Option<u8> {
        match self.state {
            AnsiState::Ground if byte == 0x1b => {
                self.state = AnsiState::Escape;
                None
            }
            AnsiState::Ground => Some(byte),
            AnsiState::Escape => {
                self.state = match byte {
                    b'[' => AnsiState::Csi,
                    b']' => AnsiState::Osc,
                    _ => AnsiState::Ground,
                };
                None
            }
            AnsiState::Csi => {
                if (0x40..=0x7e).contains(&byte) {
                    self.state = AnsiState::Ground;
                }
                None
            }
            AnsiState::Osc => {
                self.state = match byte {
                    0x07 => AnsiState::Ground,
                    0x1b => AnsiState::OscEscape,
                    _ => AnsiState::Osc,
                };
                None
            }
            AnsiState::OscEscape => {
                self.state = match byte {
                    b'\\' | 0x07 => AnsiState::Ground,
                    0x1b => AnsiState::OscEscape,
                    _ => AnsiState::Osc,
                };
                None
            }
        }
    }
}

struct ProblemCandidate {
    code: Option<String>,
    column: u32,
    line_number: u32,
    message: String,
    path: String,
    severity: NodePackageProblemSeverity,
    source: NodePackageProblemSource,
}

fn parse_typescript_line(line: &str) -> Option<ProblemCandidate> {
    let line = line.trim();
    let location_end = line.find("): ")?;
    let location_start = line[..location_end].rfind('(')?;
    let path = line[..location_start].trim();
    let (line_number, column) = parse_position(&line[location_start + 1..location_end])?;
    let remainder = &line[location_end + 3..];
    let (severity, remainder) = parse_severity(remainder)?;
    let (code, message) = remainder.split_once(": ")?;
    if !code.starts_with("TS")
        || code.len() <= 2
        || !code[2..].bytes().all(|byte| byte.is_ascii_digit())
        || message.trim().is_empty()
        || !looks_like_supported_source(path)
    {
        return None;
    }
    Some(ProblemCandidate {
        code: Some(code.to_string()),
        column,
        line_number,
        message: message.trim().to_string(),
        path: path.to_string(),
        severity,
        source: NodePackageProblemSource::TypeScript,
    })
}

fn parse_eslint_diagnostic(line: &str) -> Option<ProblemCandidate> {
    let line = line.trim_start();
    let position_end = line.find(char::is_whitespace)?;
    let (line_number, column) = parse_position_with_separator(&line[..position_end], ':')?;
    let remainder = line[position_end..].trim_start();
    let (severity, remainder) = parse_severity(remainder)?;
    let remainder = remainder.trim_start();
    if remainder.is_empty() {
        return None;
    }
    let (message, code) = split_eslint_message_and_rule(remainder);
    Some(ProblemCandidate {
        code: code.map(str::to_string),
        column,
        line_number,
        message: message.to_string(),
        path: String::new(),
        severity,
        source: NodePackageProblemSource::Eslint,
    })
}

fn parse_position(value: &str) -> Option<(u32, u32)> {
    parse_position_with_separator(value, ',')
}

fn parse_position_with_separator(value: &str, separator: char) -> Option<(u32, u32)> {
    let (line, column) = value.split_once(separator)?;
    if line.is_empty() || column.is_empty() || column.contains(separator) {
        return None;
    }
    let line = line.parse::<u32>().ok().filter(|value| *value > 0)?;
    let column = column.parse::<u32>().ok().filter(|value| *value > 0)?;
    Some((line, column))
}

fn parse_severity(value: &str) -> Option<(NodePackageProblemSeverity, &str)> {
    if let Some(remainder) = value.strip_prefix("error ") {
        Some((NodePackageProblemSeverity::Error, remainder))
    } else {
        value
            .strip_prefix("warning ")
            .map(|remainder| (NodePackageProblemSeverity::Warning, remainder))
    }
}

fn split_eslint_message_and_rule(value: &str) -> (&str, Option<&str>) {
    let bytes = value.as_bytes();
    let mut index = bytes.len();
    while index > 1 {
        index -= 1;
        if bytes[index - 1].is_ascii_whitespace() && bytes[index].is_ascii_whitespace() {
            let message = value[..index - 1].trim_end();
            let rule = value[index..].trim();
            if !message.is_empty() && !rule.is_empty() && !rule.chars().any(char::is_whitespace) {
                return (message, Some(rule));
            }
        }
    }
    (value.trim(), None)
}

fn looks_like_supported_source(value: &str) -> bool {
    is_supported_source_path(Path::new(value))
}

fn is_supported_source_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "mts" | "cts")
    )
}

fn truncate_utf8(value: &str, maximum: usize) -> String {
    if value.len() <= maximum {
        return value.to_string();
    }
    const MARKER: &str = "…[truncated]";
    let mut boundary = maximum.saturating_sub(MARKER.len()).min(value.len());
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}{}", &value[..boundary], MARKER)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_FIXTURE_ID: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        package: PathBuf,
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = loop {
                let id = NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
                let candidate = std::env::temp_dir()
                    .join(format!("node-problem-matcher-{}-{id}", std::process::id()));
                match fs::create_dir(&candidate) {
                    Ok(()) => break candidate,
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("failed to reserve matcher test fixture: {error}"),
                }
            };
            let root = fs::canonicalize(root).unwrap();
            let package = root.join("packages/app");
            fs::create_dir_all(package.join("src")).unwrap();
            fs::create_dir_all(root.join("shared")).unwrap();
            fs::write(package.join("src/app.ts"), "const x = 1;").unwrap();
            fs::write(root.join("shared/lib.ts"), "export {};").unwrap();
            Self { package, root }
        }

        fn matcher(&self, kind: NodePackageProblemMatcherKind) -> NodePackageProblemMatcher {
            let root = File::open(&self.root).unwrap();
            let package = File::open(&self.package).unwrap();
            NodePackageProblemMatcher::new(kind, &root, &self.root, &package, &self.package)
                .unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn typescript_is_anchored_supports_warnings_and_package_relative_paths() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let problems = matcher.push_bytes(
            NodePackageTaskOutputStream::Stderr,
            b"src/app.ts(12,5): error TS2322: Wrong type\n../../shared/lib.ts(2,1): warning TS6133: Unused\nnoise src/app.ts(1,1): error TS1: no\n",
        );
        assert_eq!(problems.len(), 2);
        assert_eq!(problems[0].code.as_deref(), Some("TS2322"));
        assert_eq!(problems[0].line_number, 12);
        assert_eq!(problems[1].severity, NodePackageProblemSeverity::Warning);
        assert!(problems[1].file_path.ends_with("/shared/lib.ts"));
        assert_eq!(matcher.snapshot().total, 2);
    }

    #[test]
    fn eslint_stylish_keeps_file_state_per_stream_and_extracts_rule() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::EslintStylish);
        let stderr = matcher.push_bytes(
            NodePackageTaskOutputStream::Stderr,
            b"src/app.ts\n  4:7  error  Unexpected any  @typescript-eslint/no-explicit-any\n",
        );
        assert_eq!(stderr.len(), 1);
        assert_eq!(
            stderr[0].code.as_deref(),
            Some("@typescript-eslint/no-explicit-any")
        );
        assert!(matcher
            .push_bytes(
                NodePackageTaskOutputStream::Stdout,
                b"  1:1  error  no header\n"
            )
            .is_empty());
    }

    #[test]
    fn split_utf8_ansi_csi_and_osc_are_reassembled_before_matching() {
        let fixture = Fixture::new();
        let input =
            "src/app.ts(1,2): \u{1b}[31merror\u{1b}[0m TS1000: žltý\u{1b}]0;title\u{1b}\\\n";
        for chunk_size in 1..=input.len() {
            let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
            let mut found = Vec::new();
            for chunk in input.as_bytes().chunks(chunk_size) {
                found.extend(matcher.push_bytes(NodePackageTaskOutputStream::Stdout, chunk));
            }
            found.extend(matcher.finish_stream(NodePackageTaskOutputStream::Stdout));
            assert_eq!(found.len(), 1, "chunk size {chunk_size}");
            assert_eq!(found[0].message, "žltý");
        }
    }

    #[test]
    fn crlf_cr_and_unterminated_final_lines_are_each_processed_once() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let mut found = matcher.push_bytes(
            NodePackageTaskOutputStream::Stdout,
            b"src/app.ts(1,1): error TS1: one\r\nsrc/app.ts(2,1): error TS2: two\r",
        );
        matcher.push_bytes(
            NodePackageTaskOutputStream::Stdout,
            b"src/app.ts(3,1): error TS3: three",
        );
        found.extend(matcher.finish_stream(NodePackageTaskOutputStream::Stdout));
        assert_eq!(found.len(), 3);
        assert_eq!(matcher.snapshot().scanned_lines, 3);
    }

    #[test]
    fn oversized_lines_are_discarded_and_utf8_messages_are_bounded() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let mut input = vec![b'x'; MAX_TASK_PROBLEM_LINE_BYTES + 1];
        input.extend_from_slice(b"\nsrc/app.ts(1,1): error TS1: ");
        input.extend_from_slice("ž".repeat(MAX_TASK_PROBLEM_MESSAGE_BYTES).as_bytes());
        input.push(b'\n');
        let problems = matcher.push_bytes(NodePackageTaskOutputStream::Stdout, &input);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.len() <= MAX_TASK_PROBLEM_MESSAGE_BYTES);
        assert!(problems[0].message.ends_with("…[truncated]"));
        assert!(matcher.snapshot().truncated);
    }

    #[test]
    fn paths_are_existing_regular_supported_files_confined_after_canonicalization() {
        let fixture = Fixture::new();
        let outside = fixture.root.parent().unwrap().join(format!(
            "outside-problem-{}",
            fixture.root.file_name().unwrap().to_string_lossy()
        ));
        fs::write(&outside, "outside").unwrap();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let input = format!(
            "{}(1,1): error TS1: outside\nmissing.ts(1,1): error TS2: missing\nsrc/app.txt(1,1): error TS3: unsupported\nfile://src/app.ts(1,1): error TS4: url\n",
            outside.display()
        );
        assert!(matcher
            .push_bytes(NodePackageTaskOutputStream::Stdout, input.as_bytes())
            .is_empty());
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn retained_internal_and_absolute_confined_files_resolve() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let absolute = fixture.root.join("shared/lib.ts");
        let input = format!(
            "src/app.ts(1,1): error TS1: relative\n{}(2,3): error TS2: absolute\n",
            absolute.display()
        );
        let problems = matcher.push_bytes(NodePackageTaskOutputStream::Stdout, input.as_bytes());
        assert_eq!(problems.len(), 2);
        assert_eq!(
            problems[0].file_path,
            fixture.package.join("src/app.ts").to_string_lossy()
        );
        assert_eq!(problems[1].file_path, absolute.to_string_lossy());
    }

    #[test]
    fn workspace_root_package_uses_the_retained_root_descriptor() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("root.ts"), "export {};").unwrap();
        let root = File::open(&fixture.root).unwrap();
        let package = root.try_clone().unwrap();
        let mut matcher = NodePackageProblemMatcher::new(
            NodePackageProblemMatcherKind::TypeScript,
            &root,
            &fixture.root,
            &package,
            &fixture.root,
        )
        .unwrap();
        let problems = matcher.push_bytes(
            NodePackageTaskOutputStream::Stdout,
            b"root.ts(1,1): error TS1: root package\n",
        );
        assert_eq!(problems.len(), 1);
        assert_eq!(
            problems[0].file_path,
            fixture.root.join("root.ts").to_string_lossy()
        );
    }

    #[test]
    fn package_replacement_after_descriptor_open_fails_closed() {
        let fixture = Fixture::new();
        let root = File::open(&fixture.root).unwrap();
        let package = File::open(&fixture.package).unwrap();
        let retained = fixture.root.join("packages/app-retained");
        fs::rename(&fixture.package, &retained).unwrap();
        fs::create_dir_all(fixture.package.join("src")).unwrap();
        fs::write(fixture.package.join("src/app.ts"), "replacement").unwrap();

        assert!(NodePackageProblemMatcher::new(
            NodePackageProblemMatcherKind::TypeScript,
            &root,
            &fixture.root,
            &package,
            &fixture.package,
        )
        .is_err());
    }

    #[test]
    fn package_replacement_after_matcher_start_cannot_map_replacement_file() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let retained = fixture.root.join("packages/app-retained");
        fs::rename(&fixture.package, &retained).unwrap();
        fs::create_dir_all(fixture.package.join("src")).unwrap();
        fs::write(fixture.package.join("src/app.ts"), "replacement").unwrap();

        assert!(matcher
            .push_bytes(
                NodePackageTaskOutputStream::Stdout,
                b"src/app.ts(1,1): error TS1: replacement\n",
            )
            .is_empty());
    }

    #[test]
    fn workspace_root_replacement_after_matcher_start_fails_closed() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let retained = fixture.root.with_extension("retained");
        fs::rename(&fixture.root, &retained).unwrap();
        fs::create_dir_all(fixture.package.join("src")).unwrap();
        fs::write(fixture.package.join("src/app.ts"), "replacement").unwrap();

        assert!(matcher
            .push_bytes(
                NodePackageTaskOutputStream::Stdout,
                b"src/app.ts(1,1): error TS1: replacement\n",
            )
            .is_empty());

        fs::remove_dir_all(&fixture.root).unwrap();
        fs::rename(retained, &fixture.root).unwrap();
    }

    #[test]
    fn nul_or_control_bytes_discard_the_entire_diagnostic_line() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        assert!(matcher
            .push_bytes(
                NodePackageTaskOutputStream::Stdout,
                b"src/\0app.ts(1,1): error TS1: must not be repaired\nsrc/app.ts(1,1): error TS2: bad\x08message\n",
            )
            .is_empty());
        assert!(matcher.snapshot().truncated);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = fixture.root.parent().unwrap().join(format!(
            "outside-source-{}.ts",
            fixture.root.file_name().unwrap().to_string_lossy()
        ));
        fs::write(&outside, "outside").unwrap();
        symlink(&outside, fixture.package.join("src/escape.ts")).unwrap();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        assert!(matcher
            .push_bytes(
                NodePackageTaskOutputStream::Stdout,
                b"src/escape.ts(1,1): error TS1: escaped\n",
            )
            .is_empty());
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn per_file_global_batch_and_total_caps_are_truthful() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let mut input = Vec::new();
        for index in 0..MAX_TASK_PROBLEMS_PER_FILE + 5 {
            writeln!(input, "src/app.ts(1,1): error TS{index}: problem {index}").unwrap();
        }
        let first = matcher.push_bytes(NodePackageTaskOutputStream::Stdout, &input);
        assert_eq!(first.len(), MAX_TASK_PROBLEM_BATCH);
        assert_eq!(matcher.drain_batch().len(), MAX_TASK_PROBLEM_BATCH);
        assert!(matcher.drain_batch().is_empty());
        let snapshot = matcher.snapshot();
        assert_eq!(snapshot.problems.len(), MAX_TASK_PROBLEMS_PER_FILE);
        assert_eq!(snapshot.total, (MAX_TASK_PROBLEMS_PER_FILE + 5) as u64);
        assert!(snapshot.truncated);
    }

    #[test]
    fn global_storage_cap_does_not_cap_truthful_total() {
        let fixture = Fixture::new();
        for index in 0..5 {
            fs::write(
                fixture.package.join(format!("src/file-{index}.ts")),
                "export {};",
            )
            .unwrap();
        }
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        let mut input = Vec::new();
        let expected_total = MAX_TASK_PROBLEMS + 17;
        for index in 0..expected_total {
            writeln!(
                input,
                "src/file-{}.ts(1,1): error TS{}: problem {index}",
                index % 5,
                index + 1,
            )
            .unwrap();
        }
        matcher.push_bytes(NodePackageTaskOutputStream::Stdout, &input);
        let snapshot = matcher.snapshot();
        assert_eq!(snapshot.problems.len(), MAX_TASK_PROBLEMS);
        assert_eq!(snapshot.total, expected_total as u64);
        assert!(snapshot.truncated);
    }

    #[test]
    fn scan_limit_stops_cpu_work_and_marks_snapshot_truncated() {
        let fixture = Fixture::new();
        let mut matcher = fixture.matcher(NodePackageProblemMatcherKind::TypeScript);
        matcher.scanned_lines = MAX_TASK_PROBLEM_SCANNED_LINES;
        assert!(matcher
            .push_bytes(
                NodePackageTaskOutputStream::Stdout,
                b"src/app.ts(1,1): error TS1: ignored\n",
            )
            .is_empty());
        let snapshot = matcher.snapshot();
        assert_eq!(snapshot.total, 0);
        assert!(snapshot.truncated);
    }

    #[test]
    fn invalid_root_or_package_identity_fails_closed() {
        let fixture = Fixture::new();
        let outside = fixture.root.parent().unwrap();
        let root = File::open(&fixture.root).unwrap();
        let outside_directory = File::open(outside).unwrap();
        assert!(NodePackageProblemMatcher::new(
            NodePackageProblemMatcherKind::TypeScript,
            &root,
            &fixture.root,
            &outside_directory,
            outside,
        )
        .is_err());
    }
}
