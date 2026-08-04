use super::{
    clear_errno, ensure_regular_single_link, open_directory_at, rename_at, rename_swap_at,
    run_test_hook, same_entry_snapshot, same_identity, stat_at, sync_after_commit, sync_dir,
    unique_quarantine_name, DirectoryStream, MutationFailure,
};
use std::{
    ffi::CStr,
    fs::File,
    io,
    os::fd::{AsRawFd, RawFd},
};

pub(super) fn rename_overwrite(
    from_parent: &File,
    from_name: &CStr,
    source: &libc::stat,
    to_parent: &File,
    to_name: &CStr,
    destination: &libc::stat,
) -> Result<(), MutationFailure> {
    let current_destination = stat_at(to_parent.as_raw_fd(), to_name)?;
    if !same_entry_snapshot(destination, &current_destination) {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "rename destination changed before commit",
        )
        .into());
    }
    rename_swap_at(
        from_parent.as_raw_fd(),
        from_name,
        to_parent.as_raw_fd(),
        to_name,
    )?;
    run_test_hook(
        "rename-after-swap",
        to_parent.as_raw_fd(),
        to_name,
        from_name,
    );
    let current_source = stat_at(to_parent.as_raw_fd(), to_name);
    let displaced_destination = stat_at(from_parent.as_raw_fd(), from_name);
    let committed_identities_match = current_source
        .as_ref()
        .is_ok_and(|current| same_entry_snapshot(source, current))
        && displaced_destination
            .as_ref()
            .is_ok_and(|current| same_entry_snapshot(destination, current));
    if !committed_identities_match {
        let rollback_safe = current_source
            .as_ref()
            .is_ok_and(|current| same_identity(source, current))
            && displaced_destination
                .as_ref()
                .is_ok_and(|current| same_identity(destination, current));
        if rollback_safe
            && rename_swap_at(
                from_parent.as_raw_fd(),
                from_name,
                to_parent.as_raw_fd(),
                to_name,
            )
            .is_ok()
        {
            sync_dir(from_parent).map_err(|error| {
                MutationFailure::Partial(format!(
                    "rename race was rolled back, but its directory could not be synced: {error}"
                ))
            })?;
            if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
                sync_dir(to_parent).map_err(|error| {
                    MutationFailure::Partial(format!(
                        "rename race was rolled back, but its destination directory could not be synced: {error}"
                    ))
                })?;
            }
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "rename destination changed during commit; operation was rolled back",
            )
            .into());
        }
        return Err(MutationFailure::Partial(
            "rename destination changed during commit and rollback was unsafe; reachable versions were retained".into(),
        ));
    }

    let quarantine = unique_quarantine_name(from_parent.as_raw_fd(), from_name)?;
    rename_at(
        from_parent.as_raw_fd(),
        from_name,
        from_parent.as_raw_fd(),
        &quarantine,
        true,
    )
    .map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the displaced destination could not be quarantined: {error}"
        ))
    })?;
    let quarantined = stat_at(from_parent.as_raw_fd(), &quarantine).map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the quarantined destination could not be inspected: {error}"
        ))
    })?;
    let committed_source = stat_at(to_parent.as_raw_fd(), to_name).map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the destination could not be revalidated: {error}"
        ))
    })?;
    if !same_entry_snapshot(destination, &quarantined)
        || !same_entry_snapshot(source, &committed_source)
    {
        return Err(MutationFailure::Partial(
            "rename committed with unexpected identities; quarantined data was retained".into(),
        ));
    }
    delete_entry(from_parent.as_raw_fd(), &quarantine, &quarantined).map_err(|error| {
        MutationFailure::Partial(match error {
            MutationFailure::Partial(message) => message,
            MutationFailure::Io(error) => format!(
                "rename committed, but removing the quarantined destination failed: {error}"
            ),
        })
    })?;
    sync_after_commit(from_parent, "path was renamed")?;
    if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
        sync_after_commit(to_parent, "path was renamed")?;
    }
    Ok(())
}

pub(super) fn delete_entry(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
) -> Result<(), MutationFailure> {
    let current = stat_at(parent, name)?;
    if !same_identity(expected, &current) {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "delete target changed before commit",
        )
        .into());
    }
    match current.st_mode & libc::S_IFMT {
        libc::S_IFREG => {
            ensure_regular_single_link(&current)?;
            cleanup_owned_entry(parent, name, expected, 0, "delete-before-cleanup-isolation")
                .map_err(MutationFailure::Partial)
        }
        libc::S_IFDIR => delete_directory_tree(parent, name, &current),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symlinks and special files are not supported",
        )
        .into()),
    }
}

pub(super) fn delete_directory_tree(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
) -> Result<(), MutationFailure> {
    let directory = open_directory_at(parent, name)?;
    let mut committed = false;
    let duplicate = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error().into());
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(io::Error::last_os_error().into());
    }
    let stream = DirectoryStream::from_raw(stream);
    loop {
        clear_errno();
        let entry = unsafe { libc::readdir(stream.as_ptr()) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error().unwrap_or(0) != 0 {
                return Err(if committed {
                    MutationFailure::Partial(format!(
                        "directory was partially deleted before enumeration failed: {error}"
                    ))
                } else {
                    error.into()
                });
            }
            break;
        }
        let child_name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if child_name.to_bytes() == b"." || child_name.to_bytes() == b".." {
            continue;
        }
        let child = stat_at(directory.as_raw_fd(), child_name).map_err(|error| {
            if committed {
                MutationFailure::Partial(format!(
                    "directory was partially deleted before a child could be inspected: {error}"
                ))
            } else {
                error.into()
            }
        })?;
        if let Err(error) = delete_entry(directory.as_raw_fd(), child_name, &child) {
            return Err(if committed {
                MutationFailure::Partial("directory was only partially deleted".into())
            } else {
                error
            });
        }
        committed = true;
        run_test_hook(
            "delete-directory-after-child",
            directory.as_raw_fd(),
            child_name,
            child_name,
        );
    }
    let current = stat_at(parent, name)?;
    if !same_identity(expected, &current) {
        return Err(if committed {
            MutationFailure::Partial(
                "directory contents were deleted, but the directory identity changed".into(),
            )
        } else {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "directory changed before removal",
            )
            .into()
        });
    }
    cleanup_owned_entry(
        parent,
        name,
        expected,
        libc::AT_REMOVEDIR,
        "delete-directory-before-cleanup-isolation",
    )
    .map_err(|message| {
        if committed {
            MutationFailure::Partial(format!(
                "directory contents were deleted, but removing the directory failed: {message}"
            ))
        } else {
            MutationFailure::Partial(message)
        }
    })
}

pub(super) fn cleanup_owned_entry(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
) -> Result<(), String> {
    cleanup_owned_entry_with_validation(parent, name, expected, unlink_flags, hook_event, true)
}

pub(super) fn cleanup_owned_entry_by_identity(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
) -> Result<(), String> {
    cleanup_owned_entry_with_validation(parent, name, expected, unlink_flags, hook_event, false)
}

pub(super) fn cleanup_owned_entry_with_validation(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
    validate_snapshot: bool,
) -> Result<(), String> {
    let quarantine = unique_quarantine_name(parent, name).map_err(|error| error.to_string())?;
    run_test_hook(hook_event, parent, name, &quarantine);
    rename_at(parent, name, parent, &quarantine, true).map_err(|error| {
        format!("cleanup target could not be atomically isolated; it was retained: {error}")
    })?;
    let isolated = stat_at(parent, &quarantine).map_err(|error| {
        format!("isolated cleanup target could not be validated and was retained: {error}")
    })?;
    let owns_isolated = if validate_snapshot {
        same_entry_snapshot(expected, &isolated)
    } else {
        same_identity(expected, &isolated)
    };
    if !owns_isolated {
        return Err(
            "cleanup target changed before atomic isolation; the foreign entry was retained".into(),
        );
    }
    if unsafe { libc::unlinkat(parent, quarantine.as_ptr(), unlink_flags) } != 0 {
        return Err(format!(
            "isolated cleanup target could not be removed and was retained: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}
