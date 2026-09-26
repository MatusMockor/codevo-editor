use super::{
    bounded_process::{run_bounded_command_prefix, run_bounded_command_with_input, CommandError},
    git_command,
};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

pub(super) const PINNED_GIT_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const PINNED_GIT_OUTPUT_BYTES: usize = 64 * 1024;
pub(super) const MAX_REPOSITORY_PATH_BYTES: usize = 4_096;
const MOVED_ROOT_ERROR: &str =
    "Repository directory changed during the Git operation. Refresh before trying again.";

#[derive(Default)]
pub(super) struct GitInvocation<'a> {
    pub(super) index_file: Option<&'a Path>,
    pub(super) env: &'a [(&'a str, &'a str)],
    pub(super) input: Option<Vec<u8>>,
    pub(super) deadline: Option<Instant>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum EntryKind {
    Directory,
    Symlink,
    File,
    Other,
}

pub(super) struct PinnedRoot {
    path: PathBuf,
    directory: File,
}

impl PinnedRoot {
    pub(super) fn open_top_level(
        root: &Path,
        trusted: bool,
        not_top_level: &str,
    ) -> io::Result<Self> {
        if !cfg!(unix) {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "This Git operation is currently supported only on macOS and Linux.",
            ));
        }
        let path = root.canonicalize()?;
        let directory = File::open(&path)?;
        let pinned = Self { path, directory };
        let top = pinned.output(&["rev-parse", "--show-toplevel"], trusted)?;
        if Path::new(top.trim_end()).canonicalize()? != pinned.path {
            return Err(io::Error::other(not_top_level.to_string()));
        }
        Ok(pinned)
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn validate(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let opened = self.directory.metadata()?;
            let current = std::fs::metadata(&self.path)?;
            if opened.dev() != current.dev() || opened.ino() != current.ino() {
                return Err(io::Error::other(MOVED_ROOT_ERROR));
            }
        }
        Ok(())
    }

    pub(super) fn branches(&self, trusted: bool) -> io::Result<Vec<super::GitBranch>> {
        let format = format!("--format={}", super::BRANCH_LIST_FORMAT);
        let output = self.output(&["for-each-ref", &format, "refs/heads/"], trusted)?;
        self.validate()?;
        Ok(super::parse_branch_list(&output))
    }

    pub(super) fn output(&self, args: &[&str], trusted: bool) -> io::Result<String> {
        let output = self
            .run(args, trusted, PINNED_GIT_OUTPUT_BYTES)
            .map_err(|error| io::Error::other(error.into_message()))?;
        String::from_utf8(output).map_err(|_| io::Error::other("Git returned non-UTF-8 output."))
    }

    pub(super) fn run(
        &self,
        args: &[&str],
        trusted: bool,
        max_bytes: usize,
    ) -> Result<Vec<u8>, CommandError> {
        self.run_with_index(args, trusted, max_bytes, None)
    }

    pub(super) fn run_with_index(
        &self,
        args: &[&str],
        trusted: bool,
        max_bytes: usize,
        index_file: Option<&Path>,
    ) -> Result<Vec<u8>, CommandError> {
        self.invoke(
            args,
            trusted,
            max_bytes,
            GitInvocation {
                index_file,
                ..GitInvocation::default()
            },
        )
    }

    pub(super) fn invoke(
        &self,
        args: &[&str],
        trusted: bool,
        max_bytes: usize,
        invocation: GitInvocation<'_>,
    ) -> Result<Vec<u8>, CommandError> {
        let mut command = self.command(args, trusted)?;
        if let Some(index_file) = invocation.index_file {
            command.env("GIT_INDEX_FILE", index_file);
        }
        for (name, value) in invocation.env {
            command.env(name, value);
        }
        let timeout = match invocation.deadline {
            None => PINNED_GIT_TIMEOUT,
            Some(deadline) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(CommandError::TimedOut(Duration::ZERO));
                }
                remaining.min(PINNED_GIT_TIMEOUT)
            }
        };
        run_bounded_command_with_input(command, timeout, max_bytes, invocation.input)
    }

    pub(super) fn entry_kind(&self, relative: &str) -> io::Result<Option<EntryKind>> {
        self.validate()?;
        entry_kind_at(&self.directory, relative)
    }

    pub(super) fn run_prefix(
        &self,
        args: &[&str],
        trusted: bool,
        max_bytes: usize,
    ) -> Result<(Vec<u8>, bool), CommandError> {
        run_bounded_command_prefix(self.command(args, trusted)?, PINNED_GIT_TIMEOUT, max_bytes)
    }

    fn command(&self, args: &[&str], trusted: bool) -> Result<Command, CommandError> {
        self.validate()
            .map_err(|error| CommandError::Io(error.to_string()))?;
        let mut command = git_command(trusted);
        command.current_dir(&self.path).args(args);
        #[cfg(unix)]
        {
            use std::os::{fd::AsRawFd, unix::process::CommandExt};
            let directory = self
                .directory
                .try_clone()
                .map_err(|error| CommandError::Io(error.to_string()))?;
            unsafe {
                command.pre_exec(move || {
                    if libc::fchdir(directory.as_raw_fd()) != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        Ok(command)
    }
}

pub(super) fn repository_file_path(path: &str) -> io::Result<String> {
    let valid = !path.is_empty()
        && path.len() <= MAX_REPOSITORY_PATH_BYTES
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|segment| !matches!(segment, "" | "." | ".."));
    if !valid {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git path is not a repository-relative file path.",
        ));
    }
    super::safe_relative_path(path)?;
    Ok(path.to_string())
}

#[cfg(unix)]
fn entry_kind_at(directory: &File, relative: &str) -> io::Result<Option<EntryKind>> {
    use std::{ffi::CString, os::fd::AsRawFd};
    let name = CString::new(relative)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Git path is invalid."))?;
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: `name` is a valid NUL-terminated path, `stat` points to writable
    // storage for one `libc::stat`, and the descriptor stays open for the call.
    let result = unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result != 0 {
        let error = io::Error::last_os_error();
        if matches!(
            error.raw_os_error(),
            Some(libc::ENOENT) | Some(libc::ENOTDIR)
        ) {
            return Ok(None);
        }
        return Err(error);
    }
    // SAFETY: `fstatat` returned 0, so it fully initialized `stat`.
    let mode = unsafe { stat.assume_init() }.st_mode & libc::S_IFMT;
    Ok(Some(match mode {
        libc::S_IFDIR => EntryKind::Directory,
        libc::S_IFLNK => EntryKind::Symlink,
        libc::S_IFREG => EntryKind::File,
        _ => EntryKind::Other,
    }))
}

#[cfg(not(unix))]
fn entry_kind_at(_directory: &File, _relative: &str) -> io::Result<Option<EntryKind>> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "This Git operation is currently supported only on macOS and Linux.",
    ))
}
