use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

pub(super) fn workspace_runtime_id(root_path: &str) -> String {
    primary_workspace_runtime_id(&PathBuf::from(root_path))
}

pub(super) fn workspace_runtime_id_candidates(root_path: &str) -> Vec<String> {
    let path = PathBuf::from(root_path);
    let mut candidates = Vec::new();

    push_unique_key(&mut candidates, primary_workspace_runtime_id(&path));

    if let Some(resolved) = resolve_existing_or_parent_path(&path) {
        push_unique_path_key(&mut candidates, &resolved);
    }

    push_unique_path_key(&mut candidates, &normalize_path(&path));
    candidates
}

fn primary_workspace_runtime_id(path: &Path) -> String {
    if let Ok(canonical) = path.canonicalize() {
        return path_key(&canonical);
    }

    path_key(path)
}

pub(super) fn resolve_existing_or_parent_path(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }

    let mut cursor = path.to_path_buf();
    let mut missing_components: Vec<OsString> = Vec::new();

    while !cursor.exists() {
        missing_components.push(cursor.file_name()?.to_os_string());

        if !cursor.pop() {
            return None;
        }
    }

    let mut resolved = cursor.canonicalize().ok()?;

    while let Some(component) = missing_components.pop() {
        resolved.push(component);
    }

    Some(normalize_path(&resolved))
}

pub(super) fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn push_unique_path_key(candidates: &mut Vec<String>, path: &Path) {
    push_unique_key(candidates, path_key(path));
}

fn push_unique_key(candidates: &mut Vec<String>, key: String) {
    if !candidates.contains(&key) {
        candidates.push(key);
    }
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}
