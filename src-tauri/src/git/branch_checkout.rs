use super::pinned_root::PinnedRoot;
use std::{io, path::Path};

pub(super) enum CheckoutBranchKind {
    Local,
    Remote,
}

pub(super) fn checkout(
    root: &Path,
    name: &str,
    kind: CheckoutBranchKind,
    trusted: bool,
) -> io::Result<PinnedRoot> {
    let name = name.trim();
    if name.is_empty() || name.len() > 1024 || name.starts_with('-') || name.contains("@{") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git branch name is invalid.",
        ));
    }
    let root = PinnedRoot::open_top_level(
        root,
        trusted,
        "Select the repository root before switching branches.",
    )?;
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
