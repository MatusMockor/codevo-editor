use super::{bounded_process::run_bounded_command_bytes, git_command};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    time::Duration,
};

pub(super) enum CheckoutBranchKind {
    Local,
    Remote,
}

pub(super) struct CheckoutRoot {
    path: PathBuf,
    directory: File,
}

impl CheckoutRoot {
    fn validate(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let opened = self.directory.metadata()?;
            let current = std::fs::metadata(&self.path)?;
            if opened.dev() != current.dev() || opened.ino() != current.ino() {
                return Err(io::Error::other(
                    "Repository directory changed during checkout. Refresh before trying again.",
                ));
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

    fn output(&self, args: &[&str], trusted: bool) -> io::Result<String> {
        self.validate()?;
        let mut command = git_command(trusted);
        command.current_dir(&self.path).args(args);
        #[cfg(unix)]
        {
            use std::os::{fd::AsRawFd, unix::process::CommandExt};
            let directory = self.directory.try_clone()?;
            unsafe {
                command.pre_exec(move || {
                    if libc::fchdir(directory.as_raw_fd()) != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        #[cfg(not(unix))]
        let _ = &self.directory;
        let output = run_bounded_command_bytes(command, Duration::from_secs(30), 64 * 1024)
            .map_err(|error| io::Error::other(error.into_message()))?;
        String::from_utf8(output).map_err(|_| io::Error::other("Git returned non-UTF-8 output."))
    }
}

pub(super) fn checkout(
    root: &Path,
    name: &str,
    kind: CheckoutBranchKind,
    trusted: bool,
) -> io::Result<CheckoutRoot> {
    let name = name.trim();
    if name.is_empty() || name.len() > 1024 || name.starts_with('-') || name.contains("@{") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git branch name is invalid.",
        ));
    }
    if !cfg!(unix) {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Safe branch checkout is currently supported only on macOS and Linux.",
        ));
    }
    let path = root.canonicalize()?;
    let directory = File::open(&path)?;
    let root = CheckoutRoot { path, directory };
    let top = root.output(&["rev-parse", "--show-toplevel"], trusted)?;
    if Path::new(top.trim_end()).canonicalize()? != root.path {
        return Err(io::Error::other(
            "Select the repository root before switching branches.",
        ));
    }
    let namespace = match kind {
        CheckoutBranchKind::Local => "refs/heads",
        CheckoutBranchKind::Remote => "refs/remotes",
    };
    let reference = format!("{namespace}/{name}");
    root.output(&["check-ref-format", &reference], trusted)?;
    let details = root.output(
        &[
            "for-each-ref",
            "--format=%(refname)%09%(symref)",
            &reference,
        ],
        trusted,
    )?;
    if !details.lines().any(|line| line == format!("{reference}\t")) {
        return Err(io::Error::other(
            "The selected branch no longer exists or is a symbolic reference.",
        ));
    }
    match kind {
        CheckoutBranchKind::Remote => {
            root.output(&["switch", "--track", "--", &reference], trusted)?;
        }
        CheckoutBranchKind::Local => {
            root.output(&["switch", "--no-guess", "--", name], trusted)?;
        }
    }
    root.validate()?;
    Ok(root)
}
