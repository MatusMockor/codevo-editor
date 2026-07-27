use super::MAX_JS_TEST_BATCH_PACKAGES;
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

pub(super) const MAX_BATCH_PACKAGE_ROOT_BYTES: usize = 4_096;
pub(super) const MAX_BATCH_OWNER_ID_BYTES: usize = 64;

pub(super) fn validate_package_roots(
    package_roots: Vec<String>,
) -> Result<Vec<(String, PathBuf)>, String> {
    if package_roots.is_empty() {
        return Err("JavaScript test batch must contain at least one package.".to_string());
    }
    if package_roots.len() > MAX_JS_TEST_BATCH_PACKAGES {
        return Err(format!(
            "JavaScript test batch contains {} packages; the safety limit is {MAX_JS_TEST_BATCH_PACKAGES}.",
            package_roots.len()
        ));
    }
    let mut seen = HashSet::with_capacity(package_roots.len());
    let mut normalized = Vec::with_capacity(package_roots.len());
    for value in package_roots {
        if value.len() > MAX_BATCH_PACKAGE_ROOT_BYTES
            || value.contains('\\')
            || value.contains("//")
            || value.ends_with('/')
            || value.chars().any(|character| {
                character.is_control()
                    || matches!(
                        character,
                        '\u{2028}'
                            | '\u{2029}'
                            | '\u{202a}'..='\u{202e}'
                            | '\u{2066}'..='\u{2069}'
                    )
            })
        {
            return Err("JavaScript test batch package root exceeds its safety limit.".to_string());
        }
        let path = Path::new(&value);
        if path.is_absolute()
            || path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(
                "JavaScript test batch package roots must be normalized workspace-relative paths."
                    .to_string(),
            );
        }
        let normalized_path = path.to_path_buf();
        if normalized_path.to_string_lossy() != value {
            return Err(
                "JavaScript test batch package roots must use canonical `/` separators."
                    .to_string(),
            );
        }
        if !seen.insert(normalized_path.clone()) {
            return Err("JavaScript test batch contains a duplicate package root.".to_string());
        }
        normalized.push((value, normalized_path));
    }
    for left in 0..normalized.len() {
        for right in (left + 1)..normalized.len() {
            let left_path = &normalized[left].1;
            let right_path = &normalized[right].1;
            if left_path.starts_with(right_path) || right_path.starts_with(left_path) {
                return Err(
                    "JavaScript test batch package roots must be non-overlapping siblings."
                        .to_string(),
                );
            }
        }
    }
    Ok(normalized)
}

pub(super) fn validate_owner_id(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > MAX_BATCH_OWNER_ID_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(format!("JavaScript test batch {label} is invalid."));
    }
    Ok(())
}
