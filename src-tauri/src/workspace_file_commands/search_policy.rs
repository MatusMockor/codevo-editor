use super::{directory_entries, open_directory_at, open_directory_path, open_regular_at};
use crate::search::TextSearchOptions;
use crate::workspace::FileEntryKind;
use ignore::{gitignore::GitignoreBuilder, overrides::OverrideBuilder, Match};
use regex::{NoExpand, Regex, RegexBuilder};
use std::{
    ffi::CString,
    fs::File,
    io::{self, Read},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    sync::Arc,
};

const WORKSPACE_GITIGNORE_BYTE_LIMIT: u64 = 1024 * 1024;

pub(super) fn collect_files(
    root: &File,
    scope: &Path,
    scan_limit: usize,
    display_root: &Path,
) -> io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let start = open_directory_path(root.as_raw_fd(), scope)?;
    let mut stack = vec![(
        scope.to_path_buf(),
        start,
        Vec::<Arc<ignore::gitignore::Gitignore>>::new(),
    )];
    let mut materialized = 0usize;
    while let Some((relative, directory, inherited_ignores)) = stack.pop() {
        let mut ignores = inherited_ignores;
        if let Some(local) = load_directory_gitignore(&directory, &display_root.join(&relative))? {
            ignores.push(Arc::new(local));
        }
        for entry in directory_entries(&directory)? {
            let path = relative.join(&entry.name);
            if crate::ignore_matcher::is_default_ignored_name(&entry.name)
                || gitignore_stack_ignores(&ignores, &display_root.join(&path), entry.is_directory)
            {
                continue;
            }
            materialized += 1;
            if materialized > 100_000 {
                return Err(io::Error::other(
                    "workspace search exceeded the 100000-entry safety limit",
                ));
            }
            if entry.is_directory {
                let name = CString::new(entry.name).unwrap();
                let child = open_directory_at(directory.as_raw_fd(), &name)?;
                stack.push((path, child, ignores.clone()));
            } else {
                files.push(path);
                if files.len() >= scan_limit {
                    return Ok(files);
                }
            }
        }
    }
    Ok(files)
}

pub(super) fn load_directory_gitignore(
    directory: &File,
    display_directory: &Path,
) -> io::Result<Option<ignore::gitignore::Gitignore>> {
    let file = match open_regular_at(directory.as_raw_fd(), c".gitignore", libc::O_RDONLY) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(WORKSPACE_GITIGNORE_BYTE_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > WORKSPACE_GITIGNORE_BYTE_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            ".gitignore exceeds the 1 MiB workspace-search limit",
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut builder = GitignoreBuilder::new(display_directory);
    for line in content.lines() {
        builder.add_line(None, line).map_err(io::Error::other)?;
    }
    builder.build().map(Some).map_err(io::Error::other)
}

fn gitignore_stack_ignores(
    scopes: &[Arc<ignore::gitignore::Gitignore>],
    absolute: &Path,
    is_directory: bool,
) -> bool {
    let mut ignored = false;
    for scope in scopes {
        match scope.matched_path_or_any_parents(absolute, is_directory) {
            Match::Ignore(_) => ignored = true,
            Match::Whitelist(_) => ignored = false,
            Match::None => {}
        }
    }
    ignored
}

pub(super) fn entry_rank(kind: &FileEntryKind) -> u8 {
    if matches!(kind, FileEntryKind::Directory) {
        0
    } else {
        1
    }
}

pub(super) fn text_matcher(query: &str, options: &TextSearchOptions) -> io::Result<Regex> {
    let pattern = if options.is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if options.whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}

pub(super) fn replace_text(
    matcher: &Regex,
    content: &str,
    replacement: &str,
    options: &TextSearchOptions,
) -> String {
    if !options.preserve_case {
        return replace_text_without_case_preservation(matcher, content, replacement, options);
    }
    if options.is_regex {
        return matcher
            .replace_all(content, |captures: &regex::Captures<'_>| {
                let mut expanded = String::new();
                captures.expand(replacement, &mut expanded);
                adapt_replacement_case(captures.get(0).unwrap().as_str(), &expanded)
            })
            .into_owned();
    }
    matcher
        .replace_all(content, |captures: &regex::Captures<'_>| {
            adapt_replacement_case(captures.get(0).unwrap().as_str(), replacement)
        })
        .into_owned()
}

fn replace_text_without_case_preservation(
    matcher: &Regex,
    content: &str,
    replacement: &str,
    options: &TextSearchOptions,
) -> String {
    if options.is_regex {
        return matcher.replace_all(content, replacement).into_owned();
    }
    matcher
        .replace_all(content, NoExpand(replacement))
        .into_owned()
}

fn adapt_replacement_case(matched: &str, replacement: &str) -> String {
    if is_all_upper(matched) {
        return replacement.to_uppercase();
    }
    if is_title_case(matched) {
        return capitalize_first_letter(replacement);
    }
    replacement.to_string()
}

fn is_all_upper(value: &str) -> bool {
    let letters: Vec<char> = value.chars().filter(|value| is_cased(*value)).collect();
    !letters.is_empty() && letters.iter().all(|value| value.is_uppercase())
}

fn is_title_case(value: &str) -> bool {
    let letters: Vec<char> = value.chars().filter(|value| is_cased(*value)).collect();
    if letters.is_empty() {
        return false;
    }
    letters[0].is_uppercase() && letters[1..].iter().all(|value| value.is_lowercase())
}

fn is_cased(value: char) -> bool {
    value.is_lowercase() || value.is_uppercase()
}

fn capitalize_first_letter(value: &str) -> String {
    let mut result = String::new();
    let mut capitalized = false;
    for character in value.chars() {
        if !capitalized && is_cased(character) {
            result.extend(character.to_uppercase());
            capitalized = true;
            continue;
        }
        result.push(character);
    }
    result
}

pub(super) struct FileMask {
    pub(super) matcher: ignore::overrides::Override,
    pub(super) has_positive: bool,
}

pub(super) fn file_mask(mask: &str, root: &Path) -> io::Result<Option<FileMask>> {
    let mut builder = OverrideBuilder::new(root);
    let mut any = false;
    let mut has_positive = false;
    for owned in split_file_masks(mask) {
        let item = owned.trim();
        any = true;
        has_positive |= !item.starts_with('!');
        builder.add(item).map_err(io::Error::other)?;
    }
    if any {
        builder
            .build()
            .map(|matcher| {
                Some(FileMask {
                    matcher,
                    has_positive,
                })
            })
            .map_err(io::Error::other)
    } else {
        Ok(None)
    }
}

fn split_file_masks(mask: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut brace_depth = 0usize;
    let mut escaped = false;
    for character in mask.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            current.push(character);
            escaped = true;
            continue;
        }
        if character == '{' {
            brace_depth += 1;
        }
        if character == '}' {
            brace_depth = brace_depth.saturating_sub(1);
        }
        if (character == ',' && brace_depth == 0) || character == '\n' {
            if !current.trim().is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(character);
    }
    if !current.trim().is_empty() {
        parts.push(current);
    }
    parts
}
