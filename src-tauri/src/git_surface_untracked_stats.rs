use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Component, Path};

use super::{
    complete_z_records, is_displayable, run_integration_command_prefix, LineStat, SurfaceDeadline,
    MAX_INTEGRATION_STDOUT_BYTES, MAX_SURFACE_PATH_BYTES,
};

const BINARY_PROBE_BYTES: usize = 8_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrackedStatLimits {
    pub(crate) files: usize,
    pub(crate) file_bytes: u64,
    pub(crate) total_bytes: u64,
}

pub(crate) const UNTRACKED_STAT_LIMITS: UntrackedStatLimits = UntrackedStatLimits {
    files: 500,
    file_bytes: 1024 * 1024,
    total_bytes: 16 * 1024 * 1024,
};

enum Counted {
    Lines { lines: u32, bytes: u64 },
    Uncountable,
    TooLarge,
}

pub(crate) fn untracked_line_stats(
    root: &Path,
    deadline: &SurfaceDeadline,
    slots: usize,
    limits: UntrackedStatLimits,
) -> (Vec<LineStat>, bool) {
    let Some(timeout) = deadline.remaining() else {
        return (Vec::new(), true);
    };
    let arguments = ["ls-files", "--others", "--exclude-standard", "-z", "--"].map(OsStr::new);
    let Ok((output, capped)) =
        run_integration_command_prefix(root, &arguments, timeout, MAX_INTEGRATION_STDOUT_BYTES)
    else {
        return (Vec::new(), true);
    };
    let paths = complete_z_records(&output, capped)
        .split('\0')
        .filter(|path| is_displayable(path, MAX_SURFACE_PATH_BYTES) && is_plain_relative(path));
    let mut stats = Vec::new();
    let mut budget = limits.total_bytes;
    let mut partial = capped;
    for path in paths {
        if stats.len() >= slots.min(limits.files) || deadline.remaining().is_none() {
            return (stats, true);
        }
        let added = match count_added_lines(&root.join(path), limits.file_bytes.min(budget)) {
            Counted::TooLarge => {
                partial = true;
                continue;
            }
            Counted::Uncountable => None,
            Counted::Lines { lines, bytes } => {
                budget = budget.saturating_sub(bytes);
                Some(lines)
            }
        };
        stats.push(LineStat {
            relative_path: path.to_string(),
            added,
            deleted: added.map(|_| 0),
        });
    }
    (stats, partial)
}

fn is_plain_relative(path: &str) -> bool {
    Path::new(path)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn count_added_lines(path: &Path, max_bytes: u64) -> Counted {
    let Ok(file) = open_without_following(path) else {
        return Counted::Uncountable;
    };
    let Ok(metadata) = file.metadata() else {
        return Counted::Uncountable;
    };
    if !metadata.is_file() {
        return Counted::Uncountable;
    }
    if metadata.len() > max_bytes {
        return Counted::TooLarge;
    }
    let mut bytes = Vec::new();
    if file.take(max_bytes + 1).read_to_end(&mut bytes).is_err() {
        return Counted::Uncountable;
    }
    if bytes.len() as u64 > max_bytes {
        return Counted::TooLarge;
    }
    count_text_lines(&bytes)
}

fn open_without_following(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
}

fn count_text_lines(bytes: &[u8]) -> Counted {
    let probe = &bytes[..bytes.len().min(BINARY_PROBE_BYTES)];
    if probe.contains(&0) {
        return Counted::Uncountable;
    }
    let newlines = bytes.iter().filter(|byte| **byte == b'\n').count();
    let unterminated = usize::from(bytes.last().is_some_and(|byte| *byte != b'\n'));
    let Ok(lines) = u32::try_from(newlines + unterminated) else {
        return Counted::TooLarge;
    };
    Counted::Lines {
        lines,
        bytes: bytes.len() as u64,
    }
}
