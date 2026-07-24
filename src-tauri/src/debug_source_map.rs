use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sourcemap::SourceMap;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::debug_support::{file_url_from_path, path_from_file_url};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MappedSourceLocation {
    pub file_path: String,
    pub line_number: u32,
    pub column: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MappedGeneratedLocation {
    pub url: String,
    pub line_number: u32,
    pub column: u32,
}

struct RegisteredSourceMap {
    generated_url: String,
    map: SourceMap,
    source_base: PathBuf,
}

pub(crate) struct SourceMapRegistry {
    root: PathBuf,
    maps: Vec<RegisteredSourceMap>,
}

impl SourceMapRegistry {
    pub(crate) fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|error| format!("Unable to resolve debugger workspace root: {error}"))?;
        Ok(Self {
            root,
            maps: Vec::new(),
        })
    }

    pub(crate) fn register_script(
        &mut self,
        generated_url: &str,
        source_map_url: &str,
    ) -> Result<(), String> {
        self.maps
            .retain(|entry| entry.generated_url != generated_url);
        let Some(generated_path) = path_from_file_url(generated_url).map(PathBuf::from) else {
            return Ok(());
        };
        let generated_path = self.workspace_file(&generated_path)?;
        let (bytes, source_base) = self.read_source_map(&generated_path, source_map_url)?;
        let map = SourceMap::from_slice(&bytes).map_err(|error| {
            format!("Unable to parse source map for `{generated_url}`: {error}")
        })?;
        if !self.map_has_workspace_source(&source_base, &map) {
            return Err("Source map does not reference a source inside the workspace.".to_string());
        }
        self.maps.push(RegisteredSourceMap {
            generated_url: generated_url.to_string(),
            map,
            source_base,
        });
        Ok(())
    }

    pub(crate) fn evict_script(&mut self, generated_url: &str) {
        self.maps
            .retain(|entry| entry.generated_url != generated_url);
    }

    pub(crate) fn map_generated(
        &self,
        generated_url: &str,
        line_number: u32,
        column: u32,
    ) -> Option<MappedSourceLocation> {
        let entry = self
            .maps
            .iter()
            .find(|entry| entry.generated_url == generated_url)?;
        let token = entry.map.lookup_token(line_number, column)?;
        let source = token.get_source()?;
        let file_path = self.resolve_source(&entry.source_base, source)?;
        Some(MappedSourceLocation {
            file_path: file_path.to_string_lossy().to_string(),
            line_number: token.get_src_line() + 1,
            column: token.get_src_col() + 1,
        })
    }

    pub(crate) fn map_original_line(
        &self,
        source_path: &Path,
        line_number: u32,
    ) -> Option<MappedGeneratedLocation> {
        let source_path = source_path.canonicalize().ok()?;
        if !source_path.starts_with(&self.root) {
            return None;
        }
        for entry in &self.maps {
            let mut best = None;
            for token in entry.map.tokens() {
                let Some(source) = token.get_source() else {
                    continue;
                };
                let Some(candidate) = self.resolve_source(&entry.source_base, source) else {
                    continue;
                };
                if candidate != source_path || token.get_src_line() + 1 != line_number {
                    continue;
                }
                let location = MappedGeneratedLocation {
                    url: entry.generated_url.clone(),
                    line_number: token.get_dst_line() + 1,
                    column: token.get_dst_col() + 1,
                };
                let rank = (token.get_src_col(), token.get_dst_col());
                if best
                    .as_ref()
                    .is_some_and(|(best_rank, _)| *best_rank <= rank)
                {
                    continue;
                }
                best = Some((rank, location));
            }
            if let Some((_, location)) = best {
                return Some(location);
            }
        }
        None
    }

    /// Maps a one-based editor position to the nearest generated segment whose
    /// original column is at or before the cursor on the same source line.
    pub(crate) fn map_original_position(
        &self,
        source_path: &Path,
        line_number: u32,
        column: u32,
    ) -> Option<MappedGeneratedLocation> {
        let source_path = source_path.canonicalize().ok()?;
        if column == 0 || !source_path.starts_with(&self.root) {
            return None;
        }
        let requested_column = column - 1;
        for entry in &self.maps {
            let mut best = None;
            for token in entry.map.tokens() {
                let Some(source) = token.get_source() else {
                    continue;
                };
                let Some(candidate) = self.resolve_source(&entry.source_base, source) else {
                    continue;
                };
                let source_column = token.get_src_col();
                if candidate != source_path
                    || token.get_src_line() + 1 != line_number
                    || source_column > requested_column
                {
                    continue;
                }
                let location = MappedGeneratedLocation {
                    url: entry.generated_url.clone(),
                    line_number: token.get_dst_line() + 1,
                    column: token.get_dst_col() + 1,
                };
                let rank = (source_column, std::cmp::Reverse(token.get_dst_col()));
                if best.as_ref().is_none_or(|(best_rank, _)| *best_rank < rank) {
                    best = Some((rank, location));
                }
            }
            if let Some((_, location)) = best {
                return Some(location);
            }
        }
        None
    }

    fn read_source_map(
        &self,
        generated_path: &Path,
        source_map_url: &str,
    ) -> Result<(Vec<u8>, PathBuf), String> {
        if let Some(encoded) = inline_base64_payload(source_map_url) {
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|error| format!("Unable to decode inline source map: {error}"))?;
            return Ok((
                bytes,
                generated_path.parent().unwrap_or(&self.root).to_path_buf(),
            ));
        }
        let map_path = path_from_file_url(source_map_url)
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                generated_path
                    .parent()
                    .unwrap_or(&self.root)
                    .join(source_map_url)
            });
        let map_path = self.workspace_file(&map_path)?;
        let bytes = fs::read(&map_path).map_err(|error| {
            format!(
                "Unable to read source map `{}`: {error}",
                map_path.display()
            )
        })?;
        let source_base = map_path.parent().unwrap_or(&self.root).to_path_buf();
        Ok((bytes, source_base))
    }

    fn map_has_workspace_source(&self, source_base: &Path, map: &SourceMap) -> bool {
        map.tokens().any(|token| {
            token
                .get_source()
                .and_then(|source| self.resolve_source(source_base, source))
                .is_some()
        })
    }

    fn resolve_source(&self, source_base: &Path, source: &str) -> Option<PathBuf> {
        let raw_path = path_from_file_url(source)
            .map(PathBuf::from)
            .unwrap_or_else(|| source_base.join(source));
        self.workspace_file(&raw_path).ok()
    }

    fn workspace_file(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path.canonicalize().map_err(|error| {
            format!(
                "Unable to resolve debugger source `{}`: {error}",
                path.display()
            )
        })?;
        if !canonical.starts_with(&self.root) || !canonical.is_file() {
            return Err(format!(
                "Debugger source `{}` is outside the workspace root.",
                path.display()
            ));
        }
        Ok(canonical)
    }
}

pub(crate) fn emitted_type_script_path(root: &Path, source: &Path) -> Result<PathBuf, String> {
    emitted_type_script_path_with_policy(root, source, true)
}

pub(crate) fn emitted_type_script_path_without_source_map(
    root: &Path,
    source: &Path,
) -> Result<PathBuf, String> {
    emitted_type_script_path_with_policy(root, source, false)
}

fn emitted_type_script_path_with_policy(
    root: &Path,
    source: &Path,
    require_source_map: bool,
) -> Result<PathBuf, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("Unable to resolve TypeScript source: {error}"))?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve debugger workspace root: {error}"))?;
    if !source.starts_with(&root) {
        return Err("TypeScript source is outside the workspace root.".to_string());
    }
    let config_path = nearest_tsconfig(&root, source.parent().unwrap_or(&root))
        .ok_or_else(|| "TypeScript debugging requires a tsconfig.json.".to_string())?;
    let compiler = resolve_compiler_output(&root, &config_path, &mut HashSet::new())?;
    if compiler.out_file.is_some() {
        return Err(
            "TypeScript debugging does not support compilerOptions.outFile; use outDir with source maps."
                .to_string(),
        );
    }
    let out_dir = compiler
        .out_dir
        .ok_or_else(|| "TypeScript debugging requires compilerOptions.outDir.".to_string())?;
    let source_root = match compiler.root_dir {
        Some(root_dir) => root_dir,
        None if compiler.composite.unwrap_or(false) => {
            config_path.parent().unwrap_or(&root).to_path_buf()
        }
        None => infer_common_source_root(&root, &config_path, &source, &out_dir)?,
    };
    let source_root = source_root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve TypeScript rootDir: {error}"))?;
    let relative = source
        .strip_prefix(&source_root)
        .map_err(|_| "TypeScript source is outside compilerOptions.rootDir.".to_string())?;
    let mut emitted = out_dir.join(relative);
    emitted.set_extension(emitted_extension(
        &source,
        compiler.jsx_preserve.unwrap_or(false),
    ));
    let emitted = emitted
        .canonicalize()
        .map_err(|_| "Compile the TypeScript project before debugging.".to_string())?;
    if !emitted.starts_with(&root) {
        return Err("Emitted TypeScript output is outside the workspace root.".to_string());
    }
    if require_source_map && source_map_url_from_generated(&emitted).is_none() {
        return Err(
            "Compile the TypeScript project with sourceMap enabled before debugging.".to_string(),
        );
    }
    Ok(emitted)
}

pub(crate) fn source_map_url_from_generated(generated_path: &Path) -> Option<String> {
    let content = fs::read_to_string(generated_path).ok()?;
    if let Some(url) = source_mapping_url_comment(&content) {
        return Some(url.to_string());
    }
    let map_path = PathBuf::from(format!("{}.map", generated_path.to_string_lossy()));
    map_path
        .is_file()
        .then(|| file_url_from_path(&map_path.to_string_lossy()))
}

fn nearest_tsconfig(root: &Path, start: &Path) -> Option<PathBuf> {
    let mut directory = start.to_path_buf();
    loop {
        let candidate = directory.join("tsconfig.json");
        if candidate.is_file() {
            return Some(candidate);
        }
        if directory == root || !directory.pop() {
            return None;
        }
    }
}

fn emitted_extension(source: &Path, jsx_preserve: bool) -> &'static str {
    match source.extension().and_then(|extension| extension.to_str()) {
        Some("mts") => "mjs",
        Some("cts") => "cjs",
        Some("tsx") if jsx_preserve => "jsx",
        _ => "js",
    }
}

#[derive(Default)]
struct CompilerOutput {
    root_dir: Option<PathBuf>,
    out_dir: Option<PathBuf>,
    out_file: Option<PathBuf>,
    jsx_preserve: Option<bool>,
    composite: Option<bool>,
}

impl CompilerOutput {
    fn overlay(&mut self, other: Self) {
        if other.root_dir.is_some() {
            self.root_dir = other.root_dir;
        }
        if other.out_dir.is_some() {
            self.out_dir = other.out_dir;
        }
        if other.out_file.is_some() {
            self.out_file = other.out_file;
        }
        if other.jsx_preserve.is_some() {
            self.jsx_preserve = other.jsx_preserve;
        }
        if other.composite.is_some() {
            self.composite = other.composite;
        }
    }
}

fn resolve_compiler_output(
    root: &Path,
    config_path: &Path,
    visiting: &mut HashSet<PathBuf>,
) -> Result<CompilerOutput, String> {
    let config_path = config_path
        .canonicalize()
        .map_err(|error| format!("Unable to resolve `{}`: {error}", config_path.display()))?;
    if !config_path.starts_with(root) {
        return Err("TypeScript config extends outside the workspace root.".to_string());
    }
    if !visiting.insert(config_path.clone()) {
        return Err("TypeScript config extends cycle detected.".to_string());
    }
    let text = fs::read_to_string(&config_path)
        .map_err(|error| format!("Unable to read `{}`: {error}", config_path.display()))?;
    let config: serde_json::Value = json5::from_str(&text)
        .map_err(|error| format!("Unable to parse `{}`: {error}", config_path.display()))?;
    let config_dir = config_path.parent().unwrap_or(root);
    let mut output = CompilerOutput::default();
    for parent in extends_entries(&config) {
        let parent_path = resolve_extended_config(root, config_dir, parent)?;
        let parent_output = resolve_compiler_output(root, &parent_path, visiting)?;
        output.overlay(parent_output);
    }
    let compiler = config
        .get("compilerOptions")
        .unwrap_or(&serde_json::Value::Null);
    if let Some(value) = compiler.get("rootDir").and_then(serde_json::Value::as_str) {
        output.root_dir = Some(config_dir.join(value));
    }
    if let Some(value) = compiler.get("outDir").and_then(serde_json::Value::as_str) {
        output.out_dir = Some(config_dir.join(value));
    }
    if let Some(value) = compiler.get("outFile").and_then(serde_json::Value::as_str) {
        output.out_file = Some(config_dir.join(value));
    }
    if let Some(value) = compiler.get("jsx").and_then(serde_json::Value::as_str) {
        output.jsx_preserve = Some(value.eq_ignore_ascii_case("preserve"));
    }
    if let Some(value) = compiler
        .get("composite")
        .and_then(serde_json::Value::as_bool)
    {
        output.composite = Some(value);
    }
    visiting.remove(&config_path);
    Ok(output)
}

fn extends_entries(config: &serde_json::Value) -> Vec<&str> {
    match config.get("extends") {
        Some(serde_json::Value::String(value)) => vec![value],
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect(),
        _ => Vec::new(),
    }
}

fn resolve_extended_config(root: &Path, config_dir: &Path, value: &str) -> Result<PathBuf, String> {
    if value.starts_with('.') || Path::new(value).is_absolute() {
        return config_candidates(config_dir.join(value))
            .into_iter()
            .find(|candidate| candidate.is_file())
            .ok_or_else(|| format!("Unable to resolve extended TypeScript config `{value}`."));
    }
    let (package_name, subpath) = split_package_specifier(value);
    let mut directory = Some(config_dir);
    while let Some(candidate_dir) = directory {
        if !candidate_dir.starts_with(root) {
            break;
        }
        let package_dir = candidate_dir.join("node_modules").join(package_name);
        if package_dir.is_dir() {
            let base = match subpath {
                Some(subpath) => package_dir.join(subpath),
                None => package_config_entry(&package_dir).unwrap_or_else(|| package_dir.clone()),
            };
            if let Some(config) = config_candidates(base)
                .into_iter()
                .find(|candidate| candidate.is_file())
            {
                return Ok(config);
            }
        }
        if candidate_dir == root {
            break;
        }
        directory = candidate_dir.parent();
    }
    Err(format!(
        "Unable to resolve extended TypeScript config `{value}`."
    ))
}

fn split_package_specifier(value: &str) -> (&str, Option<&str>) {
    let segment_count = if value.starts_with('@') { 2 } else { 1 };
    let split_index = value
        .match_indices('/')
        .nth(segment_count - 1)
        .map(|(index, _)| index);
    match split_index {
        Some(index) => (&value[..index], Some(&value[index + 1..])),
        None => (value, None),
    }
}

fn package_config_entry(package_dir: &Path) -> Option<PathBuf> {
    let manifest = fs::read_to_string(package_dir.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&manifest).ok()?;
    value
        .get("tsconfig")
        .and_then(serde_json::Value::as_str)
        .map(|entry| package_dir.join(entry))
}

fn config_candidates(base: PathBuf) -> [PathBuf; 3] {
    [
        base.clone(),
        base.with_extension("json"),
        base.join("tsconfig.json"),
    ]
}

fn infer_common_source_root(
    root: &Path,
    config_path: &Path,
    source: &Path,
    out_dir: &Path,
) -> Result<PathBuf, String> {
    let config_dir = config_path.parent().unwrap_or(root);
    let text = fs::read_to_string(config_path)
        .map_err(|error| format!("Unable to read `{}`: {error}", config_path.display()))?;
    let config: serde_json::Value = json5::from_str(&text)
        .map_err(|error| format!("Unable to parse `{}`: {error}", config_path.display()))?;
    let mut files = vec![source.to_path_buf()];
    if let Some(explicit) = config.get("files").and_then(serde_json::Value::as_array) {
        files.extend(
            explicit
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter_map(|entry| canonical_workspace_path(root, &config_dir.join(entry))),
        );
    } else {
        let scan_roots = include_scan_roots(root, config_dir, config.get("include"));
        let mut remaining = 20_000;
        for scan_root in scan_roots {
            remaining = collect_type_script_files(&scan_root, out_dir, &mut files, remaining);
            if remaining == 0 {
                return Err(
                    "TypeScript project is too large to infer a safe common source root; set compilerOptions.rootDir."
                        .to_string(),
                );
            }
        }
    }
    common_parent(&files)
        .ok_or_else(|| "Unable to infer TypeScript common source root.".to_string())
}

fn canonical_workspace_path(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let canonical = candidate.canonicalize().ok()?;
    canonical.starts_with(root).then_some(canonical)
}

fn include_scan_roots(
    workspace_root: &Path,
    config_dir: &Path,
    include: Option<&serde_json::Value>,
) -> Vec<PathBuf> {
    let Some(patterns) = include.and_then(serde_json::Value::as_array) else {
        return vec![config_dir.to_path_buf()];
    };
    let mut roots = Vec::new();
    for pattern in patterns.iter().filter_map(serde_json::Value::as_str) {
        let prefix = pattern.split(['*', '?']).next().unwrap_or("");
        let candidate = config_dir.join(prefix.trim_end_matches(['/', '\\']));
        let Some(path) = canonical_workspace_path(workspace_root, &candidate) else {
            continue;
        };
        let root = if path.is_file() {
            path.parent().unwrap_or(config_dir).to_path_buf()
        } else {
            path
        };
        if root.is_dir() && !roots.contains(&root) {
            roots.push(root);
        }
    }
    if roots.is_empty() {
        roots.push(config_dir.to_path_buf());
    }
    roots
}

fn collect_type_script_files(
    directory: &Path,
    out_dir: &Path,
    files: &mut Vec<PathBuf>,
    remaining: usize,
) -> usize {
    if remaining == 0 || directory.starts_with(out_dir) {
        return remaining;
    }
    let Some(name) = directory.file_name().and_then(|name| name.to_str()) else {
        return remaining;
    };
    if matches!(name, "node_modules" | ".git") {
        return remaining;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return remaining;
    };
    let mut remaining = remaining;
    for entry in entries.flatten() {
        if remaining == 0 {
            break;
        }
        remaining -= 1;
        let path = entry.path();
        if path.is_dir() {
            remaining = collect_type_script_files(&path, out_dir, files, remaining);
            continue;
        }
        if is_type_script_source(&path) {
            files.push(path);
        }
    }
    remaining
}

fn is_type_script_source(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    !name.ends_with(".d.ts")
        && !name.ends_with(".d.mts")
        && !name.ends_with(".d.cts")
        && matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("ts" | "tsx" | "mts" | "cts")
        )
}

fn common_parent(files: &[PathBuf]) -> Option<PathBuf> {
    let mut common = files.first()?.parent()?.to_path_buf();
    for file in &files[1..] {
        let parent = file.parent()?;
        while !parent.starts_with(&common) {
            if !common.pop() {
                return None;
            }
        }
    }
    Some(common)
}

fn source_mapping_url_comment(content: &str) -> Option<&str> {
    content.lines().rev().find_map(|line| {
        let line = line.trim();
        let value = line
            .strip_prefix("//# sourceMappingURL=")
            .or_else(|| line.strip_prefix("//@ sourceMappingURL="))?;
        (!value.trim().is_empty()).then(|| value.trim())
    })
}

fn inline_base64_payload(url: &str) -> Option<&str> {
    let (metadata, payload) = url.split_once(',')?;
    (metadata.starts_with("data:application/json") && metadata.ends_with(";base64"))
        .then_some(payload)
}

#[cfg(test)]
mod tests {
    use super::{
        emitted_type_script_path, emitted_type_script_path_without_source_map,
        source_map_url_from_generated, SourceMapRegistry,
    };
    use crate::debug_support::file_url_from_path;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    const MAP: &str = r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA;AACA"}"#;

    #[test]
    fn maps_stack_frames_and_breakpoints_in_both_directions() {
        let root = fixture("bidirectional");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        write(&source, "const first = 1;\nconst second = 2;\n");
        write(&generated, "const first = 1;\nconst second = 2;\n");
        write(&root.join("dist/app.js.map"), MAP);
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let map_url = file_url_from_path(&root.join("dist/app.js.map").to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");

        registry
            .register_script(&generated_url, &map_url)
            .expect("register map");

        let original = registry
            .map_generated(&generated_url, 1, 0)
            .expect("mapped frame");
        assert_eq!(original.file_path, source.to_string_lossy());
        assert_eq!((original.line_number, original.column), (2, 1));
        let emitted = registry
            .map_original_line(&source, 2)
            .expect("mapped breakpoint");
        assert_eq!(emitted.url, generated_url);
        assert_eq!((emitted.line_number, emitted.column), (2, 1));
    }

    #[test]
    fn line_breakpoint_uses_first_mapped_segment_even_when_indented() {
        let root = fixture("indented-breakpoint");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        let map_path = root.join("dist/app.js.map");
        write(&source, "    run();\n");
        write(&generated, "run();\n");
        write(
            &map_path,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAI"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        registry
            .register_script(
                &generated_url,
                &file_url_from_path(&map_path.to_string_lossy()),
            )
            .expect("map");

        let mapped = registry
            .map_original_line(&source, 1)
            .expect("first mapped segment");

        assert_eq!(mapped.url, generated_url);
        assert_eq!((mapped.line_number, mapped.column), (1, 1));
    }

    #[test]
    fn original_position_uses_nearest_segment_at_or_before_editor_column() {
        let root = fixture("column-aware-position");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        let map_path = root.join("dist/app.js.map");
        write(&source, "one two three\n");
        write(&generated, "one       two       three\n");
        // Original columns 0, 4, and 10 map to generated columns 0, 10, and 20.
        write(
            &map_path,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA,UAAI,UAAM"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        registry
            .register_script(
                &generated_url,
                &file_url_from_path(&map_path.to_string_lossy()),
            )
            .expect("map");

        for (editor_column, generated_column) in [(1, 1), (5, 11), (9, 11), (11, 21)] {
            let mapped = registry
                .map_original_position(&source, 1, editor_column)
                .expect("mapped position");
            assert_eq!(mapped.url, generated_url);
            assert_eq!((mapped.line_number, mapped.column), (1, generated_column));
        }
        assert!(registry.map_original_position(&source, 1, 0).is_none());
    }

    #[test]
    fn registers_inline_maps_with_charset_metadata() {
        let root = fixture("inline");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        write(&source, "const value = 1;\n");
        write(&generated, "const value = 1;\n");
        let url = format!(
            "data:application/json;charset=utf-8;base64,{}",
            STANDARD.encode(MAP)
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");

        registry
            .register_script(&generated_url, &url)
            .expect("register inline map");

        assert!(registry.map_generated(&generated_url, 0, 0).is_some());
    }

    #[test]
    fn rejects_maps_whose_sources_escape_the_workspace() {
        let root = fixture("contained");
        let outside = fixture("outside").join("secret.ts");
        let generated = root.join("dist/app.js");
        write(&outside, "export const secret = true;\n");
        write(&generated, "export const secret = true;\n");
        let escaped_map = format!(
            r#"{{"version":3,"file":"app.js","sources":["{}"],"names":[],"mappings":"AAAA"}}"#,
            outside.to_string_lossy()
        );
        let map_path = root.join("dist/app.js.map");
        write(&map_path, &escaped_map);
        let mut registry = SourceMapRegistry::new(&root).expect("registry");

        let error = registry
            .register_script(
                &file_url_from_path(&generated.to_string_lossy()),
                &file_url_from_path(&map_path.to_string_lossy()),
            )
            .expect_err("outside source must fail");

        assert!(error.contains("inside the workspace"));
    }

    #[test]
    fn resolves_sources_relative_to_external_map_directory() {
        let root = fixture("external-map-base");
        let source = root.join("sources/app.ts");
        let generated = root.join("dist/app.js");
        let map_path = root.join("maps/nested/app.js.map");
        write(&source, "export const value = 1;\n");
        write(&generated, "export const value = 1;\n");
        write(
            &map_path,
            r#"{"version":3,"file":"app.js","sources":["../../sources/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");

        registry
            .register_script(
                &generated_url,
                &file_url_from_path(&map_path.to_string_lossy()),
            )
            .expect("external map");

        assert_eq!(
            registry
                .map_generated(&generated_url, 0, 0)
                .expect("mapped source")
                .file_path,
            source.to_string_lossy()
        );
    }

    #[test]
    fn invalid_replacement_evicts_previous_mapping() {
        let root = fixture("stale-eviction");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        let map_path = root.join("dist/app.js.map");
        write(&source, "const value = 1;\n");
        write(&generated, "const value = 1;\n");
        write(&map_path, MAP);
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let map_url = file_url_from_path(&map_path.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        registry
            .register_script(&generated_url, &map_url)
            .expect("valid map");
        write(&map_path, "not a source map");

        assert!(registry.register_script(&generated_url, &map_url).is_err());
        assert!(registry.map_generated(&generated_url, 0, 0).is_none());

        write(&map_path, MAP);
        registry
            .register_script(&generated_url, &map_url)
            .expect("restored map");
        registry.evict_script(&generated_url);
        assert!(registry.map_generated(&generated_url, 0, 0).is_none());
    }

    #[test]
    fn resolves_emitted_typescript_from_jsonc_tsconfig() {
        let root = fixture("emitted");
        let source = root.join("src/cli.ts");
        let generated = root.join("dist/cli.js");
        write(&source, "console.log('ts');\n");
        write(&generated, "console.log('ts');\n");
        write(&root.join("dist/cli.js.map"), MAP);
        write(
            &root.join("tsconfig.json"),
            "{ // compiler output\n  compilerOptions: { rootDir: 'src', outDir: 'dist', sourceMap: true, },\n}\n",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("emitted path"),
            generated.canonicalize().expect("canonical generated")
        );
        assert!(source_map_url_from_generated(&generated).is_some());
    }

    #[test]
    fn resolves_emitted_typescript_without_requiring_a_source_map() {
        let root = fixture("emitted-without-map");
        let source = root.join("src/cli.ts");
        let generated = root.join("dist/cli.js");
        write(&source, "console.log('ts');\n");
        write(&generated, "console.log('js');\n");
        write(
            &root.join("tsconfig.json"),
            "{ compilerOptions: { rootDir: 'src', outDir: 'dist' } }",
        );

        assert_eq!(
            emitted_type_script_path_without_source_map(&root, &source)
                .expect("map-less emitted path"),
            generated.canonicalize().expect("canonical generated")
        );
        assert!(emitted_type_script_path(&root, &source).is_err());
    }

    #[test]
    fn infers_common_source_root_when_root_dir_is_omitted() {
        let root = fixture("implicit-common-root");
        let source = root.join("src/app.ts");
        let sibling = root.join("src/support.ts");
        let generated = root.join("dist/app.js");
        write(&source, "export const app = true;\n");
        write(&sibling, "export const support = true;\n");
        write(&generated, "export const app = true;\n");
        write(&root.join("dist/app.js.map"), MAP);
        write(
            &root.join("tsconfig.json"),
            "{ compilerOptions: { outDir: 'dist', sourceMap: true }, include: ['src/**/*.ts'] }",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("common source root"),
            generated.canonicalize().expect("generated")
        );
    }

    #[test]
    fn ignores_tsconfig_files_entries_that_escape_the_workspace() {
        let sandbox = fixture("files-workspace-escape");
        let root = sandbox.join("workspace/project");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        write(&sandbox.join("outside.ts"), "export const secret = true;\n");
        write(&source, "export const app = true;\n");
        write(&generated, "export const app = true;\n");
        write(&root.join("dist/app.js.map"), MAP);
        write(
            &root.join("tsconfig.json"),
            "{ compilerOptions: { outDir: 'dist', sourceMap: true }, files: ['../../outside.ts'] }",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("workspace-local inferred root"),
            generated.canonicalize().expect("generated")
        );
    }

    #[test]
    fn ignores_tsconfig_include_roots_that_escape_the_workspace() {
        let sandbox = fixture("include-workspace-escape");
        let root = sandbox.join("workspace/project");
        let source = root.join("src/app.ts");
        let generated = root.join("dist/app.js");
        write(
            &sandbox.join("outside/secret.ts"),
            "export const secret = true;\n",
        );
        write(&source, "export const app = true;\n");
        write(&generated, "export const app = true;\n");
        write(&root.join("dist/app.js.map"), MAP);
        write(
            &root.join("tsconfig.json"),
            "{ compilerOptions: { outDir: 'dist', sourceMap: true }, include: ['../../outside/**/*.ts'] }",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("workspace-local include scan"),
            generated.canonicalize().expect("generated")
        );
    }

    #[test]
    fn resolves_package_extends_from_nearest_node_modules_and_package_entry() {
        let root = fixture("package-extends");
        let project = root.join("packages/app");
        let source = project.join("src/view.tsx");
        let generated = project.join("dist/view.jsx");
        let package = project.join("node_modules/@codevo/tsconfig");
        write(&source, "export const View = () => <div />;\n");
        write(
            &generated,
            "export const View = () => <div />;\n//# sourceMappingURL=view.jsx.map\n",
        );
        write(
            &project.join("dist/view.jsx.map"),
            r#"{"version":3,"file":"view.jsx","sources":["../src/view.tsx"],"names":[],"mappings":"AAAA"}"#,
        );
        write(
            &package.join("package.json"),
            r#"{"name":"@codevo/tsconfig","tsconfig":"configs/base.json"}"#,
        );
        write(
            &package.join("configs/base.json"),
            "{ compilerOptions: { jsx: 'preserve' } }",
        );
        write(
            &project.join("tsconfig.json"),
            "{ extends: '@codevo/tsconfig', compilerOptions: { rootDir: 'src', outDir: 'dist', sourceMap: true } }",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("package extends"),
            generated.canonicalize().expect("generated")
        );
    }

    #[test]
    fn resolves_inherited_output_and_tsx_jsx_preserve() {
        let root = fixture("extends-tsx");
        let source = root.join("src/view.tsx");
        let generated = root.join("build/view.jsx");
        write(&source, "export const View = () => <div />;\n");
        write(
            &generated,
            "export const View = () => <div />;\n//# sourceMappingURL=view.jsx.map\n",
        );
        write(
            &root.join("build/view.jsx.map"),
            r#"{"version":3,"file":"view.jsx","sources":["../src/view.tsx"],"names":[],"mappings":"AAAA"}"#,
        );
        write(
            &root.join("configs/base.json"),
            "{ compilerOptions: { rootDir: '../src', outDir: '../build', jsx: 'preserve' } }",
        );
        write(
            &root.join("tsconfig.json"),
            "{ extends: './configs/base.json', compilerOptions: { sourceMap: true } }",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("inherited output"),
            generated.canonicalize().expect("generated")
        );
    }

    #[test]
    fn accepts_inline_source_map_without_adjacent_map_file() {
        let root = fixture("inline-launch");
        let source = root.join("src/inline.ts");
        let generated = root.join("dist/inline.js");
        let inline_map = r#"{"version":3,"file":"inline.js","sources":["../src/inline.ts"],"names":[],"mappings":"AAAA"}"#;
        write(&source, "export const value = 1;\n");
        write(
            &generated,
            &format!(
                "export const value = 1;\n//# sourceMappingURL=data:application/json;base64,{}\n",
                STANDARD.encode(inline_map)
            ),
        );
        write(
            &root.join("tsconfig.json"),
            "{ compilerOptions: { rootDir: 'src', outDir: 'dist', inlineSourceMap: true } }",
        );

        assert_eq!(
            emitted_type_script_path(&root, &source).expect("inline output"),
            generated.canonicalize().expect("generated")
        );
        assert!(source_map_url_from_generated(&generated)
            .expect("inline map url")
            .starts_with("data:application/json;base64,"));
    }

    #[test]
    fn rejects_out_file_with_actionable_message() {
        let root = fixture("out-file");
        let source = root.join("src/app.ts");
        write(&source, "export const value = 1;\n");
        write(
            &root.join("tsconfig.json"),
            "{ compilerOptions: { rootDir: 'src', outFile: 'dist/bundle.js', sourceMap: true } }",
        );

        let error = emitted_type_script_path(&root, &source).expect_err("outFile unsupported");

        assert!(error.contains("does not support compilerOptions.outFile"));
    }

    #[test]
    fn registries_do_not_leak_sources_between_projects() {
        let first_root = fixture("isolated-first");
        let second_root = fixture("isolated-second");
        let first_source = first_root.join("src/app.ts");
        let first_generated = first_root.join("dist/app.js");
        write(&first_source, "const first = 1;\n");
        write(&first_generated, "const first = 1;\n");
        write(&first_root.join("dist/app.js.map"), MAP);
        let generated_url = file_url_from_path(&first_generated.to_string_lossy());
        let map_url = file_url_from_path(&first_root.join("dist/app.js.map").to_string_lossy());
        let mut first = SourceMapRegistry::new(&first_root).expect("first registry");
        let second = SourceMapRegistry::new(&second_root).expect("second registry");
        first
            .register_script(&generated_url, &map_url)
            .expect("map");

        assert!(first.map_original_line(&first_source, 1).is_some());
        assert!(second.map_original_line(&first_source, 1).is_none());
    }

    fn fixture(name: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-source-map-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&path).expect("create fixture");
        path.canonicalize().expect("canonical fixture")
    }

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write fixture");
    }
}
