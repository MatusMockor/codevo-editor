use super::{
    rename_at, run_test_hook, same_entry_snapshot, same_identity, stat_at, unique_quarantine_name,
};
use std::{ffi::CStr, io, os::fd::RawFd};

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
