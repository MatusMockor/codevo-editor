use super::macos::{process_identity, verified_process_snapshot, ProcessIdentity};
#[cfg(test)]
use super::ProcessArgumentsCapture;
use super::VerifiedProcessSnapshot;
use std::ffi::c_int;
use std::net::{SocketAddr, TcpStream};

const STATUS_MATCH: c_int = 0;
const STATUS_NO_MATCH: c_int = 1;
const STATUS_INVALID_INPUT: c_int = 2;
const STATUS_UNAVAILABLE: c_int = 3;
const STATUS_CAPACITY_EXCEEDED: c_int = 4;
const STATUS_ABI_MISMATCH: c_int = 5;
const STATUS_AMBIGUOUS: c_int = 6;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum KernelLoopbackFamily {
    Ipv4,
    Ipv6,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum KernelListenerOwnershipFailure {
    CapacityExceeded,
    AmbiguousMatch,
    ConnectionObservationChanged,
    InvalidInput,
    NoMatchingListener,
    ProcessIdentityChanged,
    SystemUnavailable,
}

/// A listener observation is deliberately non-authoritative. Only an accepted
/// reverse four-tuple bound to the held client connection may guard an endpoint.
pub(super) struct NonAuthoritativeListenerObservation {
    family: KernelLoopbackFamily,
    port: u16,
    process_identity: ProcessIdentity,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct KernelHeldConnectionIdentity {
    listener_generation: u64,
    connection_generation: u64,
    connection_socket: u64,
    connection_pcb: u64,
    connection_tcp_control_block: u64,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct ValidatedHeldLoopbackTuple {
    client: SocketAddr,
    server: SocketAddr,
}

#[derive(Debug)]
pub(super) enum HeldConnectionBindingFailure {
    HeldSocketUnavailable,
    Kernel(KernelListenerOwnershipFailure),
}

/// Opaque observation that the exact immutable client connection was accepted
/// by the expected process while its security-relevant snapshot stayed stable.
///
/// This does not claim provenance for any application bytes. Callers must keep
/// this proof separate from endpoint parsing and re-prove the held connection
/// around each security-sensitive network transition.
pub(super) struct KernelBoundHeldConnection {
    _connection_identity: KernelHeldConnectionIdentity,
}

impl KernelBoundHeldConnection {
    /// Re-proves the same held tuple and process snapshot after an application
    /// exchange, then requires the opaque kernel connection generation to be
    /// unchanged. This consumes the pre-exchange proof so callers cannot
    /// accidentally treat two unrelated successful observations as continuity.
    pub(super) fn revalidate_after_exchange(
        self,
        snapshot: &VerifiedProcessSnapshot,
        family: KernelLoopbackFamily,
        port: u16,
        held_socket: &TcpStream,
    ) -> Result<Self, HeldConnectionBindingFailure> {
        let after = verify_kernel_bound_held_connection(snapshot, family, port, held_socket)?;
        if self._connection_identity != after._connection_identity {
            return Err(HeldConnectionBindingFailure::Kernel(
                KernelListenerOwnershipFailure::ConnectionObservationChanged,
            ));
        }
        Ok(after)
    }
}

unsafe extern "C" {
    fn codevo_process_owns_loopback_tcp_listener(
        process_id: c_int,
        host_port: u16,
        address_family: c_int,
    ) -> c_int;

    fn codevo_process_owns_held_loopback_tcp_connection(
        process_id: c_int,
        server_host_port: u16,
        client_host_port: u16,
        address_family: c_int,
        listener_generation: *mut u64,
        connection_generation: *mut u64,
        connection_socket: *mut u64,
        connection_pcb: *mut u64,
        connection_tcp_control_block: *mut u64,
    ) -> c_int;
}

pub(super) fn verify_process_owns_loopback_listener(
    snapshot: &VerifiedProcessSnapshot,
    family: KernelLoopbackFamily,
    port: u16,
) -> Result<NonAuthoritativeListenerObservation, KernelListenerOwnershipFailure> {
    let process_id = i32::try_from(snapshot.process_id)
        .ok()
        .filter(|process_id| *process_id > 0)
        .ok_or(KernelListenerOwnershipFailure::InvalidInput)?;
    if port == 0 {
        return Err(KernelListenerOwnershipFailure::InvalidInput);
    }
    let before = process_identity(process_id, snapshot.process_group_id)
        .map_err(|_| KernelListenerOwnershipFailure::ProcessIdentityChanged)?;
    if !snapshot_matches_identity(snapshot, before) {
        return Err(KernelListenerOwnershipFailure::ProcessIdentityChanged);
    }
    let address_family = match family {
        KernelLoopbackFamily::Ipv4 => libc::AF_INET,
        KernelLoopbackFamily::Ipv6 => libc::AF_INET6,
    };
    // SAFETY: the C shim accepts only scalar values and owns all SDK ABI
    // buffers. The PID generation is checked immediately before and after.
    let status =
        unsafe { codevo_process_owns_loopback_tcp_listener(process_id, port, address_family) };
    classify_status(status)?;
    let after = process_identity(process_id, snapshot.process_group_id)
        .map_err(|_| KernelListenerOwnershipFailure::ProcessIdentityChanged)?;
    if before != after || !snapshot_matches_identity(snapshot, after) {
        return Err(KernelListenerOwnershipFailure::ProcessIdentityChanged);
    }
    Ok(NonAuthoritativeListenerObservation {
        family,
        port,
        process_identity: after,
    })
}

pub(super) fn verify_kernel_bound_held_connection(
    snapshot: &VerifiedProcessSnapshot,
    family: KernelLoopbackFamily,
    port: u16,
    held_socket: &TcpStream,
) -> Result<KernelBoundHeldConnection, HeldConnectionBindingFailure> {
    let process_id = i32::try_from(snapshot.process_id)
        .ok()
        .filter(|process_id| *process_id > 0)
        .ok_or(HeldConnectionBindingFailure::Kernel(
            KernelListenerOwnershipFailure::InvalidInput,
        ))?;
    let held_tuple = validate_held_loopback_tuple(held_socket, family, port)
        .ok_or(HeldConnectionBindingFailure::HeldSocketUnavailable)?;
    revalidate_process_snapshot(snapshot, process_id)
        .map_err(HeldConnectionBindingFailure::Kernel)?;
    let before = verify_held_connection(
        process_id,
        family,
        held_tuple.server.port(),
        held_tuple.client.port(),
    )
    .map_err(HeldConnectionBindingFailure::Kernel)?;
    if validate_held_loopback_tuple(held_socket, family, port) != Some(held_tuple) {
        return Err(HeldConnectionBindingFailure::HeldSocketUnavailable);
    }
    let after = verify_held_connection(
        process_id,
        family,
        held_tuple.server.port(),
        held_tuple.client.port(),
    )
    .map_err(HeldConnectionBindingFailure::Kernel)?;
    if before != after {
        return Err(HeldConnectionBindingFailure::Kernel(
            KernelListenerOwnershipFailure::ConnectionObservationChanged,
        ));
    }
    revalidate_process_snapshot(snapshot, process_id)
        .map_err(HeldConnectionBindingFailure::Kernel)?;
    Ok(KernelBoundHeldConnection {
        _connection_identity: after,
    })
}

pub(super) fn is_retryable_acceptance_race(failure: &HeldConnectionBindingFailure) -> bool {
    matches!(
        failure,
        HeldConnectionBindingFailure::Kernel(
            KernelListenerOwnershipFailure::NoMatchingListener
                | KernelListenerOwnershipFailure::ConnectionObservationChanged
        )
    )
}

pub(super) fn is_systemic_binding_failure(failure: &HeldConnectionBindingFailure) -> bool {
    matches!(
        failure,
        HeldConnectionBindingFailure::Kernel(
            KernelListenerOwnershipFailure::CapacityExceeded
                | KernelListenerOwnershipFailure::AmbiguousMatch
                | KernelListenerOwnershipFailure::InvalidInput
                | KernelListenerOwnershipFailure::SystemUnavailable
        )
    )
}

fn revalidate_process_snapshot(
    expected: &VerifiedProcessSnapshot,
    process_id: i32,
) -> Result<(), KernelListenerOwnershipFailure> {
    let fresh = verified_process_snapshot(process_id, expected.process_group_id)
        .map_err(|_| KernelListenerOwnershipFailure::ProcessIdentityChanged)?;
    if process_snapshots_match(expected, &fresh) {
        Ok(())
    } else {
        Err(KernelListenerOwnershipFailure::ProcessIdentityChanged)
    }
}

fn process_snapshots_match(
    expected: &VerifiedProcessSnapshot,
    fresh: &VerifiedProcessSnapshot,
) -> bool {
    snapshot_matches_identity(
        expected,
        ProcessIdentity {
            process_id: fresh.process_id,
            process_group_id: fresh.process_group_id,
            start_seconds: fresh.start_seconds,
            start_microseconds: fresh.start_microseconds,
        },
    ) && expected.process_image == fresh.process_image
        && expected.arguments == fresh.arguments
        && expected.arguments_capture == fresh.arguments_capture
}

fn validate_held_loopback_tuple(
    held_socket: &TcpStream,
    family: KernelLoopbackFamily,
    server_port: u16,
) -> Option<ValidatedHeldLoopbackTuple> {
    let local = held_socket.local_addr().ok()?;
    let peer = held_socket.peer_addr().ok()?;
    let valid = match (family, local, peer) {
        (KernelLoopbackFamily::Ipv4, SocketAddr::V4(local), SocketAddr::V4(peer)) => {
            local.ip().is_loopback() && peer.ip().is_loopback() && peer.port() == server_port
        }
        (KernelLoopbackFamily::Ipv6, SocketAddr::V6(local), SocketAddr::V6(peer)) => {
            local.ip().is_loopback() && peer.ip().is_loopback() && peer.port() == server_port
        }
        _ => false,
    };
    (valid && local.port() > 0).then_some(ValidatedHeldLoopbackTuple {
        client: local,
        server: peer,
    })
}

fn verify_held_connection(
    process_id: i32,
    family: KernelLoopbackFamily,
    server_port: u16,
    client_port: u16,
) -> Result<KernelHeldConnectionIdentity, KernelListenerOwnershipFailure> {
    let address_family = match family {
        KernelLoopbackFamily::Ipv4 => libc::AF_INET,
        KernelLoopbackFamily::Ipv6 => libc::AF_INET6,
    };
    let mut listener_generation = 0;
    let mut connection_generation = 0;
    let mut connection_socket = 0;
    let mut connection_pcb = 0;
    let mut connection_tcp_control_block = 0;
    // SAFETY: the C shim owns all SDK ABI buffers; both output pointers are
    // valid for writes during the synchronous call.
    let status = unsafe {
        codevo_process_owns_held_loopback_tcp_connection(
            process_id,
            server_port,
            client_port,
            address_family,
            &mut listener_generation,
            &mut connection_generation,
            &mut connection_socket,
            &mut connection_pcb,
            &mut connection_tcp_control_block,
        )
    };
    classify_status(status)?;
    Ok(KernelHeldConnectionIdentity {
        listener_generation,
        connection_generation,
        connection_socket,
        connection_pcb,
        connection_tcp_control_block,
    })
}

fn classify_status(status: c_int) -> Result<(), KernelListenerOwnershipFailure> {
    match status {
        STATUS_MATCH => Ok(()),
        STATUS_NO_MATCH => Err(KernelListenerOwnershipFailure::NoMatchingListener),
        STATUS_INVALID_INPUT => Err(KernelListenerOwnershipFailure::InvalidInput),
        STATUS_CAPACITY_EXCEEDED => Err(KernelListenerOwnershipFailure::CapacityExceeded),
        STATUS_AMBIGUOUS => Err(KernelListenerOwnershipFailure::AmbiguousMatch),
        STATUS_UNAVAILABLE | STATUS_ABI_MISMATCH => {
            Err(KernelListenerOwnershipFailure::SystemUnavailable)
        }
        _ => Err(KernelListenerOwnershipFailure::SystemUnavailable),
    }
}

fn snapshot_matches_identity(
    snapshot: &VerifiedProcessSnapshot,
    identity: ProcessIdentity,
) -> bool {
    snapshot.process_id == identity.process_id
        && snapshot.process_group_id == identity.process_group_id
        && snapshot.start_seconds == identity.start_seconds
        && snapshot.start_microseconds == identity.start_microseconds
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr, TcpListener};

    fn snapshot_for_process(process_id: i32) -> VerifiedProcessSnapshot {
        // SAFETY: querying an existing PID's process group has no preconditions.
        let process_group_id = unsafe { libc::getpgid(process_id) };
        assert!(process_group_id > 0, "process group");
        let identity =
            process_identity(process_id, process_group_id as u32).expect("current identity");
        VerifiedProcessSnapshot {
            process_id: identity.process_id,
            process_group_id: identity.process_group_id,
            start_seconds: identity.start_seconds,
            start_microseconds: identity.start_microseconds,
            process_image: Vec::new(),
            arguments: Vec::new(),
            arguments_capture: ProcessArgumentsCapture::Complete,
        }
    }

    fn current_snapshot() -> VerifiedProcessSnapshot {
        // SAFETY: getting the current PID has no preconditions.
        snapshot_for_process(unsafe { libc::getpid() })
    }

    fn current_full_snapshot() -> VerifiedProcessSnapshot {
        // SAFETY: getting the current process identifiers has no preconditions.
        let process_id = unsafe { libc::getpid() };
        let process_group_id = unsafe { libc::getpgrp() };
        verified_process_snapshot(process_id, process_group_id as u32)
            .expect("current full snapshot")
    }

    #[test]
    fn current_process_exact_ipv4_and_ipv6_listeners_are_kernel_verified() {
        let snapshot = current_snapshot();

        for (listener, family) in [
            (
                TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind IPv4 listener"),
                KernelLoopbackFamily::Ipv4,
            ),
            (
                TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).expect("bind IPv6 listener"),
                KernelLoopbackFamily::Ipv6,
            ),
        ] {
            let port = listener.local_addr().expect("listener address").port();
            let proof = verify_process_owns_loopback_listener(&snapshot, family, port)
                .expect("kernel listener proof");

            assert_eq!(proof.family, family);
            assert_eq!(proof.port, port);
            assert_eq!(proof.process_identity.process_id, snapshot.process_id);
        }
    }

    #[test]
    fn wrong_pid_port_and_family_fail_closed() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind loopback listener");
        let port = listener.local_addr().expect("listener address").port();
        let snapshot = current_snapshot();

        // SAFETY: querying the parent PID has no preconditions.
        let wrong_process = snapshot_for_process(unsafe { libc::getppid() });
        assert!(verify_process_owns_loopback_listener(
            &wrong_process,
            KernelLoopbackFamily::Ipv4,
            port
        )
        .is_err());
        let wrong_port = if port == u16::MAX { port - 1 } else { port + 1 };
        assert!(matches!(
            verify_process_owns_loopback_listener(
                &snapshot,
                KernelLoopbackFamily::Ipv4,
                wrong_port
            ),
            Err(KernelListenerOwnershipFailure::NoMatchingListener)
        ));
        assert!(matches!(
            verify_process_owns_loopback_listener(&snapshot, KernelLoopbackFamily::Ipv6, port),
            Err(KernelListenerOwnershipFailure::NoMatchingListener)
        ));
    }

    #[test]
    fn status_mapping_is_closed_and_typed() {
        assert_eq!(classify_status(STATUS_MATCH), Ok(()));
        assert_eq!(
            classify_status(STATUS_CAPACITY_EXCEEDED),
            Err(KernelListenerOwnershipFailure::CapacityExceeded)
        );
        for status in [STATUS_UNAVAILABLE, STATUS_ABI_MISMATCH, 99] {
            assert_eq!(
                classify_status(status),
                Err(KernelListenerOwnershipFailure::SystemUnavailable)
            );
        }
        assert_eq!(
            classify_status(STATUS_AMBIGUOUS),
            Err(KernelListenerOwnershipFailure::AmbiguousMatch)
        );
    }

    #[test]
    fn only_acceptance_visibility_and_connection_churn_are_retryable() {
        for failure in [
            KernelListenerOwnershipFailure::NoMatchingListener,
            KernelListenerOwnershipFailure::ConnectionObservationChanged,
        ] {
            assert!(is_retryable_acceptance_race(
                &HeldConnectionBindingFailure::Kernel(failure)
            ));
        }
        for failure in [
            KernelListenerOwnershipFailure::CapacityExceeded,
            KernelListenerOwnershipFailure::AmbiguousMatch,
            KernelListenerOwnershipFailure::InvalidInput,
            KernelListenerOwnershipFailure::ProcessIdentityChanged,
            KernelListenerOwnershipFailure::SystemUnavailable,
        ] {
            assert!(!is_retryable_acceptance_race(
                &HeldConnectionBindingFailure::Kernel(failure)
            ));
        }
        assert!(!is_retryable_acceptance_race(
            &HeldConnectionBindingFailure::HeldSocketUnavailable
        ));
    }

    #[test]
    fn post_exchange_proof_cannot_be_substituted_with_another_accepted_socket() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind listener");
        let server_port = listener.local_addr().expect("listener address").port();
        let first_client =
            TcpStream::connect((Ipv4Addr::LOCALHOST, server_port)).expect("first client");
        let (_first_server, _) = listener.accept().expect("accept first client");
        let second_client =
            TcpStream::connect((Ipv4Addr::LOCALHOST, server_port)).expect("second client");
        let (_second_server, _) = listener.accept().expect("accept second client");
        let snapshot = current_full_snapshot();
        let proof = verify_kernel_bound_held_connection(
            &snapshot,
            KernelLoopbackFamily::Ipv4,
            server_port,
            &first_client,
        )
        .expect("first proof");

        assert!(matches!(
            proof.revalidate_after_exchange(
                &snapshot,
                KernelLoopbackFamily::Ipv4,
                server_port,
                &second_client
            ),
            Err(HeldConnectionBindingFailure::Kernel(
                KernelListenerOwnershipFailure::ConnectionObservationChanged
            ))
        ));
    }

    #[test]
    fn exact_held_connection_and_process_snapshot_are_kernel_bound() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind listener");
        let server_port = listener.local_addr().expect("listener address").port();
        let held_client =
            TcpStream::connect((Ipv4Addr::LOCALHOST, server_port)).expect("connect held client");
        let (_accepted_server, _) = listener.accept().expect("accept held client");
        let snapshot = current_full_snapshot();

        verify_kernel_bound_held_connection(
            &snapshot,
            KernelLoopbackFamily::Ipv4,
            server_port,
            &held_client,
        )
        .expect("bound held connection");

        let other_listener =
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind other listener");
        let other_port = other_listener
            .local_addr()
            .expect("other listener address")
            .port();
        assert!(matches!(
            verify_kernel_bound_held_connection(
                &snapshot,
                KernelLoopbackFamily::Ipv4,
                other_port,
                &held_client,
            ),
            Err(HeldConnectionBindingFailure::HeldSocketUnavailable)
        ));

        drop(listener);
        assert!(matches!(
            verify_kernel_bound_held_connection(
                &snapshot,
                KernelLoopbackFamily::Ipv4,
                server_port,
                &held_client,
            ),
            Err(HeldConnectionBindingFailure::Kernel(
                KernelListenerOwnershipFailure::NoMatchingListener
            ))
        ));
    }

    #[test]
    fn accepted_ipv6_reverse_tuple_is_authoritative() {
        let listener = TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).expect("bind IPv6 listener");
        let server_port = listener.local_addr().expect("listener address").port();
        let held_client =
            TcpStream::connect((Ipv6Addr::LOCALHOST, server_port)).expect("connect held client");
        let (_accepted_server, _) = listener.accept().expect("accept held client");
        let snapshot = current_full_snapshot();

        verify_kernel_bound_held_connection(
            &snapshot,
            KernelLoopbackFamily::Ipv6,
            server_port,
            &held_client,
        )
        .expect("bound IPv6 held connection");
    }

    #[test]
    fn accepted_reverse_tuple_rejects_wrong_ephemeral_family_and_pid() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind listener");
        let server_port = listener.local_addr().expect("listener address").port();
        let held_client =
            TcpStream::connect((Ipv4Addr::LOCALHOST, server_port)).expect("connect held client");
        let (_accepted_server, _) = listener.accept().expect("accept held client");
        let client_port = held_client.local_addr().expect("client address").port();
        // SAFETY: getting process identifiers has no preconditions.
        let process_id = unsafe { libc::getpid() };
        let parent_process_id = unsafe { libc::getppid() };
        let wrong_client_port = if client_port == u16::MAX {
            client_port - 1
        } else {
            client_port + 1
        };

        assert!(matches!(
            verify_held_connection(
                process_id,
                KernelLoopbackFamily::Ipv4,
                server_port,
                wrong_client_port
            ),
            Err(KernelListenerOwnershipFailure::NoMatchingListener)
        ));
        assert!(matches!(
            verify_held_connection(
                process_id,
                KernelLoopbackFamily::Ipv6,
                server_port,
                client_port
            ),
            Err(KernelListenerOwnershipFailure::NoMatchingListener)
        ));
        assert!(verify_held_connection(
            parent_process_id,
            KernelLoopbackFamily::Ipv4,
            server_port,
            client_port
        )
        .is_err());
    }

    #[test]
    fn process_snapshot_revalidation_rejects_exec_relevant_drift() {
        let expected = current_full_snapshot();
        let mut changed_arguments = current_full_snapshot();
        changed_arguments
            .arguments
            .push(b"--changed-after-exec".to_vec());
        assert!(!process_snapshots_match(&expected, &changed_arguments));

        let mut changed_image = current_full_snapshot();
        changed_image.process_image.push(b'x');
        assert!(!process_snapshots_match(&expected, &changed_image));

        let mut changed_capture = current_full_snapshot();
        changed_capture.arguments_capture = ProcessArgumentsCapture::Truncated;
        assert!(!process_snapshots_match(&expected, &changed_capture));
    }
}
