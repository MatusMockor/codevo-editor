#[cfg(test)]
use super::{parse_verified_node_inspector, NodeInspectorArgvFailure};
use super::{ProcessArgumentsCapture, VerifiedProcessSnapshot};
use std::mem::{size_of, MaybeUninit};

const MAX_GROUP_PROCESS_COUNT: usize = 4_096;
const MAX_KERN_PROCARGS_BYTES: usize = 256 * 1_024;
const MAX_CAPTURED_ARGUMENT_COUNT: usize = 257;
const MAX_DECLARED_ARGUMENT_COUNT: usize = MAX_KERN_PROCARGS_BYTES / 2;
const MAX_PROCESS_PATH_BYTES: usize = 4 * 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum MacProcessSnapshotFailure {
    ArgumentBufferMalformed,
    ArgumentBufferTooLarge,
    ArgumentBufferUnavailable,
    ProcessGroupInvalid,
    ProcessGroupTooLarge,
    ProcessIdentityChanged,
    ProcessIdentityUnavailable,
    ProcessImageUnavailable,
}

pub(super) fn verified_process_snapshots(
    process_group_id: u32,
) -> Result<Vec<VerifiedProcessSnapshot>, MacProcessSnapshotFailure> {
    let process_group_id = i32::try_from(process_group_id)
        .ok()
        .filter(|value| *value > 0)
        .ok_or(MacProcessSnapshotFailure::ProcessGroupInvalid)?;
    let process_ids = process_group_process_ids(process_group_id)?;
    let mut snapshots = Vec::new();
    let mut systemic_failure = false;
    for process_id in process_ids {
        match verified_process_snapshot(process_id, process_group_id as u32) {
            Ok(snapshot) => snapshots.push(snapshot),
            Err(error) => systemic_failure |= error.is_systemic(),
        }
    }
    if systemic_failure {
        return Err(MacProcessSnapshotFailure::ProcessIdentityUnavailable);
    }
    Ok(snapshots)
}

fn process_group_process_ids(process_group_id: i32) -> Result<Vec<i32>, MacProcessSnapshotFailure> {
    let mut process_ids = vec![0i32; MAX_GROUP_PROCESS_COUNT + 1];
    let buffer_bytes = process_ids
        .len()
        .checked_mul(size_of::<i32>())
        .and_then(|bytes| i32::try_from(bytes).ok())
        .ok_or(MacProcessSnapshotFailure::ProcessGroupTooLarge)?;
    // SAFETY: `process_ids` is a writable, correctly sized PID buffer and its
    // lifetime covers this synchronous libproc call.
    // SAFETY: `__error` returns this thread's writable errno location.
    unsafe {
        *libc::__error() = 0;
    }
    let process_count = unsafe {
        libc::proc_listpgrppids(
            process_group_id,
            process_ids.as_mut_ptr().cast(),
            buffer_bytes,
        )
    };
    // SAFETY: reading this thread's errno immediately after the libproc call
    // distinguishes a legitimate empty group from an unavailable query.
    if process_count == 0 && unsafe { *libc::__error() } != 0 {
        return Err(MacProcessSnapshotFailure::ProcessIdentityUnavailable);
    }
    let process_count = usize::try_from(process_count)
        .map_err(|_| MacProcessSnapshotFailure::ProcessIdentityUnavailable)?;
    if process_count > MAX_GROUP_PROCESS_COUNT {
        return Err(MacProcessSnapshotFailure::ProcessGroupTooLarge);
    }
    if process_count > process_ids.len() {
        return Err(MacProcessSnapshotFailure::ProcessIdentityUnavailable);
    }
    process_ids.truncate(process_count);
    process_ids.retain(|process_id| *process_id > 0);
    process_ids.sort_unstable();
    process_ids.dedup();
    Ok(process_ids)
}

pub(super) fn verified_process_snapshot(
    process_id: i32,
    expected_process_group_id: u32,
) -> Result<VerifiedProcessSnapshot, MacProcessSnapshotFailure> {
    let before = process_identity(process_id, expected_process_group_id)?;
    let captured_image = process_image(process_id)?;
    let captured_arguments = process_arguments(process_id)?;
    let after = process_identity(process_id, expected_process_group_id)?;
    let confirmed_image = process_image(process_id)?;
    let final_identity = process_identity(process_id, expected_process_group_id)?;
    if before != after || after != final_identity || captured_image != confirmed_image {
        return Err(MacProcessSnapshotFailure::ProcessIdentityChanged);
    }
    Ok(VerifiedProcessSnapshot {
        process_id: before.process_id,
        process_group_id: before.process_group_id,
        start_seconds: before.start_seconds,
        start_microseconds: before.start_microseconds,
        process_image: captured_image,
        arguments: captured_arguments.arguments,
        arguments_capture: captured_arguments.capture,
    })
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) struct ProcessIdentity {
    pub(super) process_id: u32,
    pub(super) process_group_id: u32,
    pub(super) start_seconds: u64,
    pub(super) start_microseconds: u64,
}

pub(super) fn process_identity(
    process_id: i32,
    expected_process_group_id: u32,
) -> Result<ProcessIdentity, MacProcessSnapshotFailure> {
    let mut info = MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let expected_bytes = i32::try_from(size_of::<libc::proc_bsdinfo>())
        .map_err(|_| MacProcessSnapshotFailure::ProcessIdentityUnavailable)?;
    clear_errno();
    // SAFETY: `info` points to writable storage of exactly the requested
    // `proc_bsdinfo` size and is initialized only after a full-size result.
    let written_bytes = unsafe {
        libc::proc_pidinfo(
            process_id,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            expected_bytes,
        )
    };
    if written_bytes != expected_bytes {
        return Err(if process_churn_errno() {
            MacProcessSnapshotFailure::ProcessIdentityChanged
        } else {
            MacProcessSnapshotFailure::ProcessIdentityUnavailable
        });
    }
    // SAFETY: the exact-size check above proves libproc initialized the struct.
    let info = unsafe { info.assume_init() };
    let process_id_u32 = u32::try_from(process_id)
        .ok()
        .filter(|value| *value > 0)
        .ok_or(MacProcessSnapshotFailure::ProcessIdentityUnavailable)?;
    // The attach picker is strictly local to the current desktop user.
    if info.pbi_pid != process_id_u32
        || info.pbi_pgid != expected_process_group_id
        || info.pbi_uid != unsafe { libc::geteuid() }
        || info.pbi_start_tvusec >= 1_000_000
    {
        return Err(MacProcessSnapshotFailure::ProcessIdentityChanged);
    }
    Ok(ProcessIdentity {
        process_id: info.pbi_pid,
        process_group_id: info.pbi_pgid,
        start_seconds: info.pbi_start_tvsec,
        start_microseconds: info.pbi_start_tvusec,
    })
}

impl MacProcessSnapshotFailure {
    fn is_systemic(self) -> bool {
        matches!(
            self,
            Self::ArgumentBufferUnavailable
                | Self::ProcessIdentityUnavailable
                | Self::ProcessImageUnavailable
        )
    }
}

fn process_image(process_id: i32) -> Result<Vec<u8>, MacProcessSnapshotFailure> {
    let mut path = vec![0u8; MAX_PROCESS_PATH_BYTES];
    clear_errno();
    // SAFETY: `path` is writable for the advertised capacity and remains alive
    // for the duration of the synchronous libproc call.
    let written_bytes = unsafe {
        libc::proc_pidpath(
            process_id,
            path.as_mut_ptr().cast(),
            MAX_PROCESS_PATH_BYTES as u32,
        )
    };
    let written_bytes = usize::try_from(written_bytes)
        .ok()
        .filter(|bytes| *bytes > 0 && *bytes < MAX_PROCESS_PATH_BYTES)
        .ok_or_else(|| {
            if process_churn_errno() {
                MacProcessSnapshotFailure::ProcessIdentityChanged
            } else {
                MacProcessSnapshotFailure::ProcessImageUnavailable
            }
        })?;
    path.truncate(written_bytes);
    Ok(path)
}

#[derive(Debug, Eq, PartialEq)]
struct CapturedProcessArguments {
    arguments: Vec<Vec<u8>>,
    capture: ProcessArgumentsCapture,
}

fn process_arguments(
    process_id: i32,
) -> Result<CapturedProcessArguments, MacProcessSnapshotFailure> {
    let mut raw = vec![0u8; MAX_KERN_PROCARGS_BYTES];
    let mut returned_bytes = raw.len();
    let mut query = [libc::CTL_KERN, libc::KERN_PROCARGS2, process_id];
    clear_errno();
    // SAFETY: `query` is a valid three-int sysctl MIB, `raw` is writable for
    // `returned_bytes`, and no new value is supplied.
    let result = unsafe {
        libc::sysctl(
            query.as_mut_ptr(),
            query.len() as libc::c_uint,
            raw.as_mut_ptr().cast(),
            &mut returned_bytes,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 {
        if process_churn_errno() {
            return Err(MacProcessSnapshotFailure::ProcessIdentityChanged);
        }
        return Err(
            if std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOMEM) {
                MacProcessSnapshotFailure::ArgumentBufferTooLarge
            } else {
                MacProcessSnapshotFailure::ArgumentBufferUnavailable
            },
        );
    }
    if returned_bytes > raw.len() {
        return Err(MacProcessSnapshotFailure::ArgumentBufferTooLarge);
    }
    raw.truncate(returned_bytes);
    decode_kern_procargs2(&raw)
}

fn process_churn_errno() -> bool {
    matches!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH) | Some(libc::ENOENT)
    )
}

fn clear_errno() {
    // SAFETY: macOS exposes thread-local errno through `__error`; this only
    // clears the calling thread's value before an API whose failure we inspect.
    unsafe {
        *libc::__error() = 0;
    }
}

fn decode_kern_procargs2(
    raw: &[u8],
) -> Result<CapturedProcessArguments, MacProcessSnapshotFailure> {
    let argc_bytes = raw
        .get(..size_of::<i32>())
        .ok_or(MacProcessSnapshotFailure::ArgumentBufferMalformed)?;
    let argc = i32::from_ne_bytes(
        argc_bytes
            .try_into()
            .map_err(|_| MacProcessSnapshotFailure::ArgumentBufferMalformed)?,
    );
    let argc = usize::try_from(argc)
        .ok()
        .filter(|argc| *argc > 0 && *argc <= MAX_DECLARED_ARGUMENT_COUNT)
        .ok_or(MacProcessSnapshotFailure::ArgumentBufferMalformed)?;
    let mut cursor = size_of::<i32>();
    cursor = consume_nul_terminated(raw, cursor)?.1;
    while raw.get(cursor) == Some(&0) {
        cursor += 1;
    }

    let mut argv = Vec::with_capacity(argc.min(MAX_CAPTURED_ARGUMENT_COUNT));
    for argument_index in 0..argc {
        let (argument, next) = consume_nul_terminated(raw, cursor)?;
        if argument_index < MAX_CAPTURED_ARGUMENT_COUNT {
            argv.push(argument.to_vec());
        }
        cursor = next;
    }
    // argv[0] is caller-controlled process text and never participates in image
    // authority; `proc_pidpath` supplied that independently.
    Ok(CapturedProcessArguments {
        arguments: argv.into_iter().skip(1).collect(),
        capture: if argc <= MAX_CAPTURED_ARGUMENT_COUNT {
            ProcessArgumentsCapture::Complete
        } else {
            ProcessArgumentsCapture::Truncated
        },
    })
}

fn consume_nul_terminated(
    raw: &[u8],
    start: usize,
) -> Result<(&[u8], usize), MacProcessSnapshotFailure> {
    let tail = raw
        .get(start..)
        .ok_or(MacProcessSnapshotFailure::ArgumentBufferMalformed)?;
    let relative_end = tail
        .iter()
        .position(|byte| *byte == 0)
        .ok_or(MacProcessSnapshotFailure::ArgumentBufferMalformed)?;
    let end = start
        .checked_add(relative_end)
        .ok_or(MacProcessSnapshotFailure::ArgumentBufferMalformed)?;
    Ok((&raw[start..end], end + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(arguments: &[&[u8]]) -> Vec<u8> {
        let mut raw = i32::try_from(arguments.len())
            .expect("argc")
            .to_ne_bytes()
            .to_vec();
        raw.extend_from_slice(b"/verified/bin/node\0\0");
        for argument in arguments {
            raw.extend_from_slice(argument);
            raw.push(0);
        }
        raw
    }

    #[test]
    fn decoder_preserves_exact_raw_argument_boundaries_and_drops_argv_zero() {
        assert_eq!(
            decode_kern_procargs2(&encoded(&[
                b"spoofed-python",
                b"--inspect=9230",
                &[0xff, b'x'],
            ])),
            Ok(CapturedProcessArguments {
                arguments: vec![b"--inspect=9230".to_vec(), vec![0xff, b'x']],
                capture: ProcessArgumentsCapture::Complete,
            })
        );
    }

    #[test]
    fn decoder_rejects_truncation_invalid_argc_and_missing_arguments() {
        for raw in [
            Vec::new(),
            0i32.to_ne_bytes().to_vec(),
            (MAX_CAPTURED_ARGUMENT_COUNT as i32 + 1)
                .to_ne_bytes()
                .to_vec(),
            {
                let mut raw = 1i32.to_ne_bytes().to_vec();
                raw.extend_from_slice(b"/node-without-nul");
                raw
            },
            {
                let mut raw = 2i32.to_ne_bytes().to_vec();
                raw.extend_from_slice(b"/node\0\0node\0");
                raw
            },
        ] {
            assert_eq!(
                decode_kern_procargs2(&raw),
                Err(MacProcessSnapshotFailure::ArgumentBufferMalformed)
            );
        }
    }

    #[test]
    fn decoder_validates_large_opaque_tail_without_retaining_it() {
        let mut arguments = vec![
            b"node".as_slice(),
            b"--inspect=9230".as_slice(),
            b"app.js".as_slice(),
        ];
        arguments.extend(std::iter::repeat_n(
            b"opaque-tail".as_slice(),
            1_000 - arguments.len(),
        ));
        let decoded = decode_kern_procargs2(&encoded(&arguments)).expect("large valid argv");
        assert_eq!(decoded.capture, ProcessArgumentsCapture::Truncated);
        assert_eq!(decoded.arguments.len(), MAX_CAPTURED_ARGUMENT_COUNT - 1);
        assert_eq!(
            decoded.arguments.first().map(Vec::as_slice),
            Some(b"--inspect=9230".as_slice())
        );
        assert_eq!(
            decoded.arguments.get(1).map(Vec::as_slice),
            Some(b"app.js".as_slice())
        );

        let snapshot = VerifiedProcessSnapshot {
            process_id: 41,
            process_group_id: 40,
            start_seconds: 1_000,
            start_microseconds: 5,
            process_image: b"/verified/bin/node".to_vec(),
            arguments: decoded.arguments,
            arguments_capture: decoded.capture,
        };
        assert!(parse_verified_node_inspector(snapshot)
            .expect("retained script boundary makes the opaque tail safe")
            .is_some());
    }

    #[test]
    fn decoder_marks_a_hidden_last_wins_inspector_override_unsafe() {
        let mut arguments = vec![b"node".as_slice()];
        arguments.extend(std::iter::repeat_n(
            b"--inspect=9230".as_slice(),
            MAX_CAPTURED_ARGUMENT_COUNT - 1,
        ));
        arguments.push(b"--inspect=9231");
        arguments.push(b"app.js");
        let decoded = decode_kern_procargs2(&encoded(&arguments)).expect("valid adversarial argv");
        let snapshot = VerifiedProcessSnapshot {
            process_id: 41,
            process_group_id: 40,
            start_seconds: 1_000,
            start_microseconds: 5,
            process_image: b"/verified/bin/node".to_vec(),
            arguments: decoded.arguments,
            arguments_capture: decoded.capture,
        };

        assert!(matches!(
            parse_verified_node_inspector(snapshot),
            Err(NodeInspectorArgvFailure::IncompleteArguments)
        ));
    }

    #[test]
    fn live_process_group_inventory_and_argv_acquisition_match_current_process() {
        // SAFETY: these libc accessors have no preconditions.
        let process_id = unsafe { libc::getpid() };
        // SAFETY: querying the caller's process group has no preconditions.
        let process_group_id = unsafe { libc::getpgrp() };
        assert!(process_group_process_ids(process_group_id)
            .expect("current process group")
            .contains(&process_id));
        process_arguments(process_id).expect("current process argv");
    }

    #[test]
    fn systemic_snapshot_failures_are_not_classified_as_expected_churn() {
        for failure in [
            MacProcessSnapshotFailure::ArgumentBufferUnavailable,
            MacProcessSnapshotFailure::ProcessIdentityUnavailable,
            MacProcessSnapshotFailure::ProcessImageUnavailable,
        ] {
            assert!(failure.is_systemic(), "{failure:?}");
        }
        for failure in [
            MacProcessSnapshotFailure::ArgumentBufferMalformed,
            MacProcessSnapshotFailure::ArgumentBufferTooLarge,
            MacProcessSnapshotFailure::ProcessIdentityChanged,
        ] {
            assert!(!failure.is_systemic(), "{failure:?}");
        }
    }
}
