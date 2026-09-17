//! A bounded snapshot of on-disk Claude instructions, including ignored project rules.
use super::instruction_wire::{InstructionFile, InstructionScope, InstructionSnapshot};
use std::collections::BTreeSet;
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

struct ScanBudget {
    entries: usize,
    deadline: Instant,
}
#[derive(Clone, Copy)]
struct ImportBudget {
    depth: usize,
    deadline: Instant,
}
fn check_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        return Err(
            "Instruction collection exceeded 10 seconds; narrow the project root and retry".into(),
        );
    }
    Ok(())
}
#[path = "instruction_collection_fs.rs"]
mod fs;

pub(super) fn collect_instructions_from_root(
    project_root: Option<&File>,
) -> Result<InstructionSnapshot, String> {
    let global = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
        .ok_or("Cannot locate global Claude instructions")?;
    collect(&global, project_root)
}

fn collect(global: &Path, project: Option<&File>) -> Result<InstructionSnapshot, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut files = Vec::new();
    let mut stamps = Vec::new();
    let global_exists = match std::fs::symlink_metadata(global) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(format!(
                "Cannot inspect global instruction directory: {error}"
            ))
        }
    };
    if global_exists {
        collect_scope(
            &fs::open_root(global)?,
            InstructionScope::Global,
            &mut files,
            &mut stamps,
            deadline,
        )?;
    }
    if let Some(project) = project {
        collect_scope(
            project,
            InstructionScope::Project,
            &mut files,
            &mut stamps,
            deadline,
        )?;
    }
    for stamp in stamps {
        check_deadline(deadline)?;
        stamp.validate()?;
    }
    let snapshot = InstructionSnapshot { version: 1, files };
    snapshot.validate()?;
    Ok(snapshot)
}

fn collect_scope(
    root: &File,
    scope: InstructionScope,
    files: &mut Vec<InstructionFile>,
    stamps: &mut Vec<fs::Stamp>,
    deadline: Instant,
) -> Result<(), String> {
    let root = Arc::new(root.try_clone().map_err(|e| e.to_string())?);
    let mut candidates = BTreeSet::new();
    scan(
        &root,
        &root,
        Path::new(""),
        &scope,
        &mut ScanBudget {
            entries: 0,
            deadline,
        },
        &mut candidates,
        stamps,
    )?;
    let mut seen = BTreeSet::new();
    for candidate in candidates {
        append(
            &root,
            &scope,
            &candidate,
            files,
            &mut seen,
            ImportBudget { depth: 0, deadline },
            stamps,
        )?;
    }
    Ok(())
}

fn skipped(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".turbo"
            | ".cache"
            | "vendor"
            | ".venv"
            | "venv"
    )
}

fn is_rule(path: &Path, scope: &InstructionScope) -> bool {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    match scope {
        InstructionScope::Global => {
            path == Path::new("CLAUDE.md")
                || (path.starts_with("rules") && path.extension().is_some_and(|s| s == "md"))
        }
        InstructionScope::Project => {
            matches!(name, "CLAUDE.md" | "CLAUDE.local.md")
                || (path.extension().is_some_and(|s| s == "md")
                    && path
                        .components()
                        .collect::<Vec<_>>()
                        .windows(2)
                        .any(|pair| {
                            pair[0].as_os_str() == ".claude" && pair[1].as_os_str() == "rules"
                        }))
        }
    }
}

fn safe_path(path: &Path) -> Result<String, String> {
    let value = path.to_str().ok_or("Instruction paths must use UTF-8")?;
    if value.is_empty()
        || value.len() > 512
        || value
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
        || path.components().any(|component| {
            component
                .as_os_str()
                .to_str()
                .is_some_and(|part| part.eq_ignore_ascii_case(".git"))
        })
        || path.components().count() > 32
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Instruction path is unsafe or exceeds 512 bytes / 32 levels".into());
    }
    Ok(value.to_owned())
}

fn scan(
    root: &Arc<File>,
    dir: &File,
    relative: &Path,
    scope: &InstructionScope,
    budget: &mut ScanBudget,
    candidates: &mut BTreeSet<PathBuf>,
    stamps: &mut Vec<fs::Stamp>,
) -> Result<(), String> {
    check_deadline(budget.deadline)?;
    stamps.push(fs::Stamp::capture_directory(root, relative, dir)?);
    let names = fs::names(dir, 50_000usize.saturating_sub(budget.entries))?;
    budget.entries += names.len();
    for name in names {
        check_deadline(budget.deadline)?;
        let name_str = name.to_str().unwrap_or("");
        if skipped(name_str) {
            continue;
        }
        let path = relative.join(&name);
        let rule = is_rule(&path, scope);
        // Global discovery never crawls settings, credentials, caches, or sessions.
        if matches!(scope, InstructionScope::Global)
            && relative.as_os_str().is_empty()
            && name_str != "rules"
            && name_str != "CLAUDE.md"
        {
            continue;
        }
        let kind = fs::metadata_at(dir, &name)?;
        if kind == libc::S_IFLNK {
            if rule
                || (matches!(scope, InstructionScope::Global) && path.starts_with("rules"))
                || path
                    .components()
                    .collect::<Vec<_>>()
                    .windows(2)
                    .any(|pair| pair[0].as_os_str() == ".claude" && pair[1].as_os_str() == "rules")
                || name_str == ".claude"
                || (matches!(scope, InstructionScope::Global) && name_str == "rules")
            {
                return Err(format!(
                    "Instruction symlinks are unsupported: {}",
                    path.display()
                ));
            }
            continue;
        }
        if kind == libc::S_IFDIR {
            safe_path(&path)?;
            let child = fs::open_child(dir, &name)?;
            scan(root, &child, &path, scope, budget, candidates, stamps)?;
        } else if rule {
            if kind != libc::S_IFREG {
                return Err("Instructions must be regular files".into());
            }
            safe_path(&path)?;
            candidates.insert(path);
            if candidates.len() > 128 {
                return Err("Instruction snapshot exceeds 128 files".into());
            }
        }
    }
    Ok(())
}

fn append(
    root: &Arc<File>,
    scope: &InstructionScope,
    path: &Path,
    files: &mut Vec<InstructionFile>,
    seen: &mut BTreeSet<PathBuf>,
    budget: ImportBudget,
    stamps: &mut Vec<fs::Stamp>,
) -> Result<(), String> {
    if seen.contains(path) {
        return Ok(());
    }
    check_deadline(budget.deadline)?;
    if budget.depth > 32 {
        return Err("Instruction import depth exceeds 32".into());
    }
    if files.len() >= 128 {
        return Err("Instruction snapshot exceeds 128 files".into());
    }
    let path_string = safe_path(path)?;
    let (content, stamp) = fs::read(root, path)
        .map_err(|e| format!("Cannot collect instruction {path_string}: {e}"))?;
    if files.iter().map(|file| file.content.len()).sum::<usize>() + content.len() > 512 * 1024 {
        return Err("Instruction snapshot exceeds 512 KiB".into());
    }
    stamps.push(stamp);
    let imported = imports(&content)?;
    seen.insert(path.to_owned());
    files.push(InstructionFile {
        scope: scope.clone(),
        path: path_string,
        content,
    });
    for import in imported {
        let resolved = resolve_import(path, &import)?;
        append(
            root,
            scope,
            &resolved,
            files,
            seen,
            ImportBudget {
                depth: budget.depth + 1,
                ..budget
            },
            stamps,
        )?;
    }
    Ok(())
}

fn resolve_import(source: &Path, import: &str) -> Result<PathBuf, String> {
    if import.starts_with(['/', '~']) || import.contains(['\\', ':']) {
        return Err("Absolute/home instruction imports cannot be synchronized yet; use relative Markdown imports inside the project or Claude config directory".into());
    }
    let mut path = source.parent().unwrap_or(Path::new("")).to_path_buf();
    for component in Path::new(import).components() {
        match component {
            Component::Normal(value) => path.push(value),
            Component::CurDir => {}
            Component::ParentDir if path.pop() => {}
            _ => {
                return Err(
                    "Instruction import escapes its root; use an in-root Markdown file".into(),
                )
            }
        }
    }
    safe_path(&path)?;
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("md"))
    {
        return Err("Only Markdown instruction imports can be synchronized".into());
    }
    Ok(path)
}

fn imports(content: &str) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let mut fenced = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let mut code = false;
        let chars: Vec<char> = line.chars().collect();
        let mut cursor = 0;
        while cursor < chars.len() {
            if chars[cursor] == '`' {
                code = !code;
                cursor += 1;
                continue;
            }
            if !code
                && chars[cursor] == '@'
                && (cursor == 0 || chars[cursor - 1].is_whitespace() || chars[cursor - 1] == '(')
            {
                cursor += 1;
                let quoted = cursor < chars.len() && chars[cursor] == '"';
                if quoted {
                    cursor += 1;
                }
                let start = cursor;
                while cursor < chars.len()
                    && (quoted || !chars[cursor].is_whitespace())
                    && !matches!(chars[cursor], '`' | ')' | ']' | '"' | '\'')
                {
                    cursor += 1;
                }
                let value: String = chars[start..cursor].iter().collect();
                let docblock_annotation = !quoted
                    && !trimmed.starts_with('@')
                    && value.split('/').all(|part| {
                        matches!(part.trim_start_matches('@'), "param" | "var" | "throws")
                    });
                if !value.is_empty() && !docblock_annotation {
                    if result.len() >= 128 {
                        return Err("Too many instruction imports".into());
                    }
                    result.push(value);
                }
            } else {
                cursor += 1;
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
#[path = "instruction_collection_tests.rs"]
mod tests;
