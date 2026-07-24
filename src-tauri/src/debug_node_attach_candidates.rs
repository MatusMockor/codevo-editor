const DEFAULT_INSPECTOR_PORT: u16 = 9_229;
const MAX_PROCESS_OPTION_COUNT: usize = 256;
const MAX_PROCESS_ARG_BYTES: usize = 16 * 1_024;
const MAX_PROCESS_OPTION_BYTES: usize = 128 * 1_024;
const MAX_PROCESS_IMAGE_BYTES: usize = 4 * 1_024;

#[cfg(target_os = "macos")]
#[path = "debug_node_attach_macos.rs"]
mod macos;

#[cfg(target_os = "macos")]
#[path = "debug_node_attach_socket_owner_macos.rs"]
mod socket_owner_macos;

#[path = "debug_node_attach_inventory.rs"]
mod inventory;

#[path = "debug_node_attach_endpoint.rs"]
mod endpoint;
#[path = "debug_node_attach_http.rs"]
mod http;

#[cfg(test)]
pub(super) use endpoint::NodeAttachEndpointFailure;
#[cfg(target_os = "macos")]
pub(super) use inventory::collect_fresh_terminal_observations;
#[cfg(test)]
pub(super) use inventory::terminal_authority_observation_for_test;
pub(super) use inventory::{
    EndpointObservationFailure, EndpointObservedNodeAttachCandidate,
    EndpointObservedNodeAttachCandidateIssue, TerminalAuthorityObservation,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LoopbackHost {
    Ipv4,
    Ipv6,
    Localhost,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct LoopbackInspectorEndpoint {
    host: LoopbackHost,
    port: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProcessArgumentsCapture {
    Complete,
    Truncated,
}

/// Opaque proof produced only by a platform verifier in this module hierarchy.
/// The generation fields bind process identity to a single acquisition epoch;
/// the same proof must be revalidated before candidate publication and consume.
pub(crate) struct VerifiedProcessSnapshot {
    process_id: u32,
    process_group_id: u32,
    start_seconds: u64,
    start_microseconds: u64,
    process_image: Vec<u8>,
    arguments: Vec<Vec<u8>>,
    arguments_capture: ProcessArgumentsCapture,
}

pub(crate) struct DiscoveredNodeInspectorCandidate {
    snapshot: VerifiedProcessSnapshot,
    endpoint: LoopbackInspectorEndpoint,
}

pub(crate) struct RevalidatedNodeInspectorCandidate {
    snapshot: VerifiedProcessSnapshot,
    endpoint: LoopbackInspectorEndpoint,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp::node_attach_orchestrator) enum CandidateEndpointMetadataFailure {
    Connect,
    KernelBinding,
    Http,
    PlatformUnavailable,
    UnsupportedEndpoint,
}

#[cfg(target_os = "macos")]
pub(super) struct CandidateKernelHeldAttachRequest {
    family: socket_owner_macos::KernelLoopbackFamily,
    snapshot: VerifiedProcessSnapshot,
    port: u16,
}

#[cfg(target_os = "macos")]
pub(super) struct CandidateKernelBoundHeldConnection {
    proof: socket_owner_macos::KernelBoundHeldConnection,
    expected_process_id: u32,
    snapshot: VerifiedProcessSnapshot,
}

#[cfg(target_os = "macos")]
pub(super) struct CandidateSnapshotRevalidatedKernelBoundConnection {
    _proof: socket_owner_macos::KernelBoundHeldConnection,
}

#[cfg(target_os = "macos")]
enum ProcessSnapshotProvider {
    Platform,
    #[cfg(test)]
    DeterministicDrift,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CandidateKernelHeldAttachFailure {
    BindingFailed,
    UnsupportedEndpoint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct StaleVerifiedNodeInspectorCandidate;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodeInspectorArgvFailure {
    IncompleteArguments,
    InvalidInspectorConfiguration,
    ArgumentTooLarge,
    TooManyArguments,
    ArgumentsTooLarge,
    ProcessImageTooLarge,
}

/// Recognizes an inspector only from an opaque, generation-bound process proof.
/// The captured arguments deliberately exclude `argv[0]`: caller-controlled
/// argv text can never become executable identity through this API.
///
/// This Phase A policy is Unix-only and recognizes explicit Node inspector CLI
/// flags. Environment-only and signal-activated inspectors are deferred until
/// live endpoint evidence can be bound to the same process proof.
pub(crate) fn parse_verified_node_inspector(
    snapshot: VerifiedProcessSnapshot,
) -> Result<Option<DiscoveredNodeInspectorCandidate>, NodeInspectorArgvFailure> {
    let Some(endpoint) = parse_node_inspector_argv_with_capture(
        &snapshot.process_image,
        &snapshot.arguments,
        snapshot.arguments_capture,
    )?
    else {
        return Ok(None);
    };
    Ok(Some(DiscoveredNodeInspectorCandidate {
        snapshot,
        endpoint,
    }))
}

impl DiscoveredNodeInspectorCandidate {
    pub(crate) fn revalidate(
        self,
        fresh_snapshot: VerifiedProcessSnapshot,
    ) -> Result<RevalidatedNodeInspectorCandidate, StaleVerifiedNodeInspectorCandidate> {
        if !self.snapshot.same_generation(&fresh_snapshot) {
            return Err(StaleVerifiedNodeInspectorCandidate);
        }
        let fresh = parse_verified_node_inspector(fresh_snapshot)
            .ok()
            .flatten()
            .ok_or(StaleVerifiedNodeInspectorCandidate)?;
        if fresh.endpoint != self.endpoint {
            return Err(StaleVerifiedNodeInspectorCandidate);
        }
        Ok(RevalidatedNodeInspectorCandidate {
            snapshot: fresh.snapshot,
            endpoint: fresh.endpoint,
        })
    }

    #[cfg(target_os = "macos")]
    pub(in crate::debug_cdp::node_attach_orchestrator) fn fetch_endpoint_metadata(
        &self,
    ) -> Result<Vec<u8>, CandidateEndpointMetadataFailure> {
        fetch_kernel_bound_endpoint_metadata(&self.snapshot, self.endpoint)
    }
}

#[cfg(target_os = "macos")]
impl RevalidatedNodeInspectorCandidate {
    pub(in crate::debug_cdp::node_attach_orchestrator) fn fetch_endpoint_metadata(
        &self,
    ) -> Result<Vec<u8>, CandidateEndpointMetadataFailure> {
        fetch_kernel_bound_endpoint_metadata(&self.snapshot, self.endpoint)
    }
}

#[cfg(target_os = "macos")]
fn fetch_kernel_bound_endpoint_metadata(
    snapshot: &VerifiedProcessSnapshot,
    endpoint: LoopbackInspectorEndpoint,
) -> Result<Vec<u8>, CandidateEndpointMetadataFailure> {
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
    use std::time::{Duration, Instant};

    const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
    const IO_TIMEOUT: Duration = Duration::from_secs(2);
    const ACCEPTANCE_PROOF_TIMEOUT: Duration = Duration::from_millis(250);
    const ACCEPTANCE_RETRY_DELAY: Duration = Duration::from_millis(2);

    if endpoint.host != LoopbackHost::Ipv4 || endpoint.port == 0 {
        return Err(CandidateEndpointMetadataFailure::UnsupportedEndpoint);
    }
    let address = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, endpoint.port));
    let mut held_socket = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT)
        .map_err(|_| CandidateEndpointMetadataFailure::Connect)?;
    held_socket
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|_| CandidateEndpointMetadataFailure::Connect)?;
    held_socket
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|_| CandidateEndpointMetadataFailure::Connect)?;

    // The accepted reverse tuple and listener PID are proven before the first
    // request byte is written. `held_socket` is then passed directly to the
    // bounded parser; there is no reconnect or hostname resolution.
    let proof_deadline = Instant::now()
        .checked_add(ACCEPTANCE_PROOF_TIMEOUT)
        .ok_or(CandidateEndpointMetadataFailure::KernelBinding)?;
    let proof = loop {
        match socket_owner_macos::verify_kernel_bound_held_connection(
            snapshot,
            socket_owner_macos::KernelLoopbackFamily::Ipv4,
            endpoint.port,
            &held_socket,
        ) {
            Ok(proof) => break proof,
            Err(failure)
                if socket_owner_macos::is_retryable_acceptance_race(&failure)
                    && Instant::now() < proof_deadline =>
            {
                std::thread::sleep(ACCEPTANCE_RETRY_DELAY);
            }
            Err(failure) => {
                return Err(
                    if socket_owner_macos::is_systemic_binding_failure(&failure) {
                        CandidateEndpointMetadataFailure::PlatformUnavailable
                    } else {
                        CandidateEndpointMetadataFailure::KernelBinding
                    },
                );
            }
        }
    };
    let body = http::fetch_json_list(&mut held_socket, endpoint.port)
        .map_err(|_| CandidateEndpointMetadataFailure::Http)?;
    // No retry is permitted after the first request byte. The consumed
    // pre-proof must revalidate to the same opaque kernel connection identity,
    // with another full process snapshot check, before response bytes escape.
    let _post_proof = proof
        .revalidate_after_exchange(
            snapshot,
            socket_owner_macos::KernelLoopbackFamily::Ipv4,
            endpoint.port,
            &held_socket,
        )
        .map_err(|failure| {
            if socket_owner_macos::is_systemic_binding_failure(&failure) {
                CandidateEndpointMetadataFailure::PlatformUnavailable
            } else {
                CandidateEndpointMetadataFailure::KernelBinding
            }
        })?;
    Ok(body)
}

#[cfg(target_os = "macos")]
impl RevalidatedNodeInspectorCandidate {
    pub(super) fn into_kernel_held_attach_request(
        self,
    ) -> Result<CandidateKernelHeldAttachRequest, CandidateKernelHeldAttachFailure> {
        if self.endpoint.host != LoopbackHost::Ipv4 || self.endpoint.port == 0 {
            return Err(CandidateKernelHeldAttachFailure::UnsupportedEndpoint);
        }
        Ok(CandidateKernelHeldAttachRequest {
            family: socket_owner_macos::KernelLoopbackFamily::Ipv4,
            snapshot: self.snapshot,
            port: self.endpoint.port,
        })
    }
}

#[cfg(target_os = "macos")]
impl CandidateKernelHeldAttachRequest {
    pub(super) fn bind(
        self,
        held_socket: &std::net::TcpStream,
        connected_port: u16,
    ) -> Result<CandidateKernelBoundHeldConnection, CandidateKernelHeldAttachFailure> {
        if connected_port != self.port {
            return Err(CandidateKernelHeldAttachFailure::BindingFailed);
        }
        let expected_process_id = self.snapshot.process_id;
        let proof = socket_owner_macos::verify_kernel_bound_held_connection(
            &self.snapshot,
            self.family,
            self.port,
            held_socket,
        )
        .map_err(|_| CandidateKernelHeldAttachFailure::BindingFailed)?;
        Ok(CandidateKernelBoundHeldConnection {
            proof,
            expected_process_id,
            snapshot: self.snapshot,
        })
    }
}

#[cfg(target_os = "macos")]
impl CandidateKernelBoundHeldConnection {
    pub(super) fn expected_process_id(&self) -> u32 {
        self.expected_process_id
    }

    pub(super) fn revalidate_process_snapshot(
        self,
    ) -> Result<CandidateSnapshotRevalidatedKernelBoundConnection, CandidateKernelHeldAttachFailure>
    {
        self.revalidate_process_snapshot_with(ProcessSnapshotProvider::Platform)
    }

    fn revalidate_process_snapshot_with(
        self,
        snapshot_provider: ProcessSnapshotProvider,
    ) -> Result<CandidateSnapshotRevalidatedKernelBoundConnection, CandidateKernelHeldAttachFailure>
    {
        let process_id = i32::try_from(self.snapshot.process_id)
            .ok()
            .filter(|process_id| *process_id > 0)
            .ok_or(CandidateKernelHeldAttachFailure::BindingFailed)?;
        let fresh = macos::verified_process_snapshot(process_id, self.snapshot.process_group_id)
            .map_err(|_| CandidateKernelHeldAttachFailure::BindingFailed)?;
        #[cfg(test)]
        let fresh = match snapshot_provider {
            ProcessSnapshotProvider::Platform => fresh,
            ProcessSnapshotProvider::DeterministicDrift => {
                let mut drifted = fresh;
                drifted.start_microseconds = drifted.start_microseconds.checked_add(1).unwrap_or(0);
                drifted
            }
        };
        #[cfg(not(test))]
        let _ = snapshot_provider;
        if !self.snapshot.same_generation(&fresh) {
            return Err(CandidateKernelHeldAttachFailure::BindingFailed);
        }
        Ok(CandidateSnapshotRevalidatedKernelBoundConnection { _proof: self.proof })
    }

    #[cfg(test)]
    pub(super) fn revalidate_process_snapshot_with_drift_for_test(
        self,
    ) -> Result<CandidateSnapshotRevalidatedKernelBoundConnection, CandidateKernelHeldAttachFailure>
    {
        self.revalidate_process_snapshot_with(ProcessSnapshotProvider::DeterministicDrift)
    }
}

#[cfg(all(test, target_os = "macos"))]
pub(super) fn kernel_held_attach_request_for_current_process(
    port: u16,
) -> CandidateKernelHeldAttachRequest {
    // SAFETY: these process identifier accessors have no preconditions.
    let process_id = unsafe { libc::getpid() };
    // SAFETY: querying the caller's process group has no preconditions.
    let process_group_id = unsafe { libc::getpgrp() };
    let snapshot = macos::verified_process_snapshot(process_id, process_group_id as u32)
        .expect("current process snapshot");
    CandidateKernelHeldAttachRequest {
        family: socket_owner_macos::KernelLoopbackFamily::Ipv4,
        snapshot,
        port,
    }
}

impl VerifiedProcessSnapshot {
    fn same_generation(&self, other: &Self) -> bool {
        self.process_id == other.process_id
            && self.process_group_id == other.process_group_id
            && self.start_seconds == other.start_seconds
            && self.start_microseconds == other.start_microseconds
            && self.process_image == other.process_image
            && self.arguments == other.arguments
            && self.arguments_capture == other.arguments_capture
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_node_http_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    struct ChildGuard(Child);

    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn real_node_json_list_is_fetched_only_after_kernel_acceptance_proof() {
        if Command::new("node").arg("--version").output().is_err() {
            return;
        }
        let mut child = ChildGuard(
            Command::new("node")
                .args(["--inspect=127.0.0.1:0", "-e", "setInterval(() => {}, 1000)"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn Node inspector"),
        );
        let stderr = child.0.stderr.take().expect("Node stderr");
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let line = BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .find(|line| line.contains("Debugger listening on ws://127.0.0.1:"));
            let _ = sender.send(line);
        });
        let line = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("Node inspector announcement")
            .expect("Node inspector listening line");
        let port = line
            .split("ws://127.0.0.1:")
            .nth(1)
            .and_then(|tail| tail.split('/').next())
            .and_then(|port| port.parse::<u16>().ok())
            .expect("Node inspector port");

        let process_id = i32::try_from(child.0.id()).expect("child PID");
        // SAFETY: `process_id` names the live child retained by `ChildGuard`.
        let process_group_id = unsafe { libc::getpgid(process_id) };
        assert!(process_group_id > 0);
        let snapshot = macos::verified_process_snapshot(process_id, process_group_id as u32)
            .expect("verified Node snapshot");
        let body = fetch_kernel_bound_endpoint_metadata(
            &snapshot,
            LoopbackInspectorEndpoint {
                host: LoopbackHost::Ipv4,
                port,
            },
        )
        .expect("kernel-bound /json/list");
        let targets: serde_json::Value = serde_json::from_slice(&body).expect("Node target JSON");
        assert_eq!(targets.as_array().map(Vec::len), Some(1));
    }
}

fn parse_node_inspector_argv(
    verified_process_image: &[u8],
    arguments: &[Vec<u8>],
) -> Result<Option<LoopbackInspectorEndpoint>, NodeInspectorArgvFailure> {
    parse_node_inspector_argv_with_capture(
        verified_process_image,
        arguments,
        ProcessArgumentsCapture::Complete,
    )
}

fn parse_node_inspector_argv_with_capture(
    verified_process_image: &[u8],
    arguments: &[Vec<u8>],
    arguments_capture: ProcessArgumentsCapture,
) -> Result<Option<LoopbackInspectorEndpoint>, NodeInspectorArgvFailure> {
    if verified_process_image.len() > MAX_PROCESS_IMAGE_BYTES {
        return Err(NodeInspectorArgvFailure::ProcessImageTooLarge);
    }
    if !is_node_process_image(verified_process_image) {
        return Ok(None);
    }

    let mut inspector_enabled = false;
    let mut effective_address = InspectorAddress::default();
    let mut option_count = 0usize;
    let mut option_bytes = 0usize;
    let mut index = 0;
    let mut fixed_option_boundary = false;
    while let Some(argument) = arguments.get(index).map(Vec::as_slice) {
        account_option_argument(argument, &mut option_count, &mut option_bytes)?;
        if matches!(argument, b"-" | b"--") || !argument.starts_with(b"-") {
            fixed_option_boundary = true;
            break;
        }
        if let Some(address) = parse_inspector_trigger(argument)? {
            inspector_enabled = true;
            if let Some(address) = address {
                effective_address = address;
            }
        } else if let Some(value) = inspector_port_value(argument) {
            effective_address = parse_inspector_address(value)
                .ok_or(NodeInspectorArgvFailure::InvalidInspectorConfiguration)?;
        } else if matches!(argument, b"--inspect-port" | b"--debug-port") {
            let value = arguments
                .get(index + 1)
                .map(Vec::as_slice)
                .ok_or(NodeInspectorArgvFailure::InvalidInspectorConfiguration)?;
            account_option_argument(value, &mut option_count, &mut option_bytes)?;
            effective_address = parse_inspector_address(value)
                .ok_or(NodeInspectorArgvFailure::InvalidInspectorConfiguration)?;
            index += 1;
        } else if option_consumes_next_argument(argument) {
            let value = arguments
                .get(index + 1)
                .map(Vec::as_slice)
                .ok_or(NodeInspectorArgvFailure::InvalidInspectorConfiguration)?;
            account_option_argument(value, &mut option_count, &mut option_bytes)?;
            index += 1;
        }
        index += 1;
    }

    if arguments_capture == ProcessArgumentsCapture::Truncated && !fixed_option_boundary {
        return Err(NodeInspectorArgvFailure::IncompleteArguments);
    }
    if !inspector_enabled {
        return Ok(None);
    }
    let InspectorHost::Loopback(host) = effective_address.host else {
        return Err(NodeInspectorArgvFailure::InvalidInspectorConfiguration);
    };
    if effective_address.port == 0 {
        return Err(NodeInspectorArgvFailure::InvalidInspectorConfiguration);
    }
    Ok(Some(LoopbackInspectorEndpoint {
        host,
        port: effective_address.port,
    }))
}

fn account_option_argument(
    argument: &[u8],
    option_count: &mut usize,
    option_bytes: &mut usize,
) -> Result<(), NodeInspectorArgvFailure> {
    if argument.len() > MAX_PROCESS_ARG_BYTES {
        return Err(NodeInspectorArgvFailure::ArgumentTooLarge);
    }
    *option_count = option_count
        .checked_add(1)
        .ok_or(NodeInspectorArgvFailure::TooManyArguments)?;
    if *option_count > MAX_PROCESS_OPTION_COUNT {
        return Err(NodeInspectorArgvFailure::TooManyArguments);
    }
    *option_bytes = option_bytes
        .checked_add(argument.len())
        .ok_or(NodeInspectorArgvFailure::ArgumentsTooLarge)?;
    if *option_bytes > MAX_PROCESS_OPTION_BYTES {
        return Err(NodeInspectorArgvFailure::ArgumentsTooLarge);
    }
    Ok(())
}

fn is_node_process_image(process_image: &[u8]) -> bool {
    process_image
        .rsplit(|byte| matches!(byte, b'/' | b'\\'))
        .next()
        .is_some_and(|name| matches!(name, b"node" | b"nodejs"))
}

#[derive(Clone, Copy)]
struct InspectorAddress {
    host: InspectorHost,
    port: u16,
}

#[derive(Clone, Copy)]
enum InspectorHost {
    Loopback(LoopbackHost),
    Remote,
}

impl Default for InspectorAddress {
    fn default() -> Self {
        Self {
            host: InspectorHost::Loopback(LoopbackHost::Ipv4),
            port: DEFAULT_INSPECTOR_PORT,
        }
    }
}

/// `Some(None)` means an inspector trigger using the current configured port.
fn parse_inspector_trigger(
    argument: &[u8],
) -> Result<Option<Option<InspectorAddress>>, NodeInspectorArgvFailure> {
    for flag in [
        b"--inspect".as_slice(),
        b"--inspect-brk".as_slice(),
        b"--inspect-wait".as_slice(),
    ] {
        if argument == flag {
            return Ok(Some(None));
        }
        if argument.starts_with(flag) && argument.get(flag.len()) == Some(&b'=') {
            let value = &argument[flag.len() + 1..];
            let port = parse_inspector_address(value)
                .ok_or(NodeInspectorArgvFailure::InvalidInspectorConfiguration)?;
            return Ok(Some(Some(port)));
        }
    }
    Ok(None)
}

fn inspector_port_value(argument: &[u8]) -> Option<&[u8]> {
    argument
        .strip_prefix(b"--inspect-port=")
        .or_else(|| argument.strip_prefix(b"--debug-port="))
}

fn parse_inspector_address(value: &[u8]) -> Option<InspectorAddress> {
    let value = std::str::from_utf8(value).ok()?;
    if let Ok(port) = value.parse::<u16>() {
        return Some(InspectorAddress {
            host: InspectorHost::Loopback(LoopbackHost::Ipv4),
            port,
        });
    }
    if let Some(host) = parse_loopback_host(value) {
        return Some(InspectorAddress {
            host: InspectorHost::Loopback(host),
            port: DEFAULT_INSPECTOR_PORT,
        });
    }
    let (host, port) = value.rsplit_once(':')?;
    if host.is_empty() {
        return None;
    }
    let host = parse_loopback_host(host)
        .map(InspectorHost::Loopback)
        .unwrap_or(InspectorHost::Remote);
    Some(InspectorAddress {
        host,
        port: port.parse::<u16>().ok()?,
    })
}

fn parse_loopback_host(host: &str) -> Option<LoopbackHost> {
    match host {
        "127.0.0.1" => Some(LoopbackHost::Ipv4),
        "[::1]" => Some(LoopbackHost::Ipv6),
        "localhost" => Some(LoopbackHost::Localhost),
        _ => None,
    }
}

fn option_consumes_next_argument(argument: &[u8]) -> bool {
    if argument.contains(&b'=') {
        return false;
    }
    matches!(
        argument,
        b"-C"
            | b"--conditions"
            | b"--cpu-prof-dir"
            | b"--debug-port"
            | b"--diagnostic-dir"
            | b"-e"
            | b"--eval"
            | b"--env-file"
            | b"--env-file-if-exists"
            | b"--experimental-config-file"
            | b"--experimental-default-config-file"
            | b"--experimental-loader"
            | b"--experimental-policy"
            | b"--heap-prof-dir"
            | b"--input-type"
            | b"--icu-data-dir"
            | b"--import"
            | b"--loader"
            | b"--openssl-config"
            | b"-p"
            | b"--print"
            | b"-r"
            | b"--require"
            | b"--redirect-warnings"
            | b"--report-dir"
            | b"--report-directory"
            | b"--report-filename"
            | b"--report-signal"
            | b"--secure-heap"
            | b"--secure-heap-min"
            | b"--snapshot-blob"
            | b"--test-name-pattern"
            | b"--test-reporter"
            | b"--test-reporter-destination"
            | b"--test-shard"
            | b"--title"
            | b"--tls-cipher-list"
            | b"--trace-event-categories"
            | b"--v8-pool-size"
            | b"--watch-path"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(arguments: &[&str]) -> Vec<Vec<u8>> {
        arguments
            .iter()
            .map(|argument| argument.as_bytes().to_vec())
            .collect()
    }

    fn parse(
        arguments: &[&str],
    ) -> Result<Option<LoopbackInspectorEndpoint>, NodeInspectorArgvFailure> {
        let snapshot = VerifiedProcessSnapshot {
            process_id: 41,
            process_group_id: 40,
            start_seconds: 1_000,
            start_microseconds: 5,
            process_image: b"/verified/bin/node".to_vec(),
            arguments: argv(arguments),
            arguments_capture: ProcessArgumentsCapture::Complete,
        };
        parse_verified_node_inspector(snapshot)
            .map(|candidate| candidate.map(|candidate| candidate.endpoint))
    }

    #[test]
    fn exact_argv_accepts_loopback_inspector_variants_and_port_override() {
        for (arguments, host, port) in [
            (vec!["--inspect", "server.js"], LoopbackHost::Ipv4, 9_229),
            (
                vec!["--inspect-brk=9230", "api.js"],
                LoopbackHost::Ipv4,
                9_230,
            ),
            (
                vec!["--inspect-wait=127.0.0.1:9231", "worker.js"],
                LoopbackHost::Ipv4,
                9_231,
            ),
            (
                vec!["--inspect-port=localhost:9232", "--inspect", "app.js"],
                LoopbackHost::Localhost,
                9_232,
            ),
            (
                vec!["--inspect", "--inspect-port", "[::1]:9233", "app.js"],
                LoopbackHost::Ipv6,
                9_233,
            ),
            (
                vec!["--inspect-publish-uid=stderr", "--inspect=9234", "app.js"],
                LoopbackHost::Ipv4,
                9_234,
            ),
        ] {
            assert_eq!(
                parse(&arguments),
                Ok(Some(LoopbackInspectorEndpoint { host, port })),
                "{arguments:?}"
            );
        }
    }

    #[test]
    fn exact_argv_uses_verified_image_not_caller_controlled_argv_zero() {
        assert_eq!(
            parse_node_inspector_argv(b"/usr/bin/python", &argv(&["--inspect", "app.py"])),
            Ok(None)
        );
        assert_eq!(
            parse_node_inspector_argv(
                &[b'/', 0xff, b'/', b'n', b'o', b'd', b'e'],
                &argv(&["--inspect", "app.js"])
            ),
            Ok(Some(LoopbackInspectorEndpoint {
                host: LoopbackHost::Ipv4,
                port: 9_229
            }))
        );
    }

    #[test]
    fn exact_argv_rejects_false_positives_after_entry_or_option_boundary() {
        for arguments in [
            vec!["app.js", "--inspect"],
            vec!["-", "--inspect"],
            vec!["--", "app.js", "--inspect"],
            vec!["-r", "./hook.js", "app.js", "--inspect"],
        ] {
            assert_eq!(parse(&arguments), Ok(None), "{arguments:?}");
        }
    }

    #[test]
    fn node_options_with_operands_do_not_hide_later_inspector_flags() {
        for arguments in [
            vec!["-r", "./hook.js", "--inspect=9230", "app.js"],
            vec!["--require", "./hook.js", "--inspect=9230", "app.js"],
            vec!["--title", "custom", "--inspect=9230", "app.js"],
            vec!["-e", "setInterval(() => {}, 1000)", "--inspect=9230"],
            vec!["--eval", "setInterval(() => {}, 1000)", "--inspect=9230"],
            vec!["--import", "./setup.mjs", "--inspect=9230", "app.js"],
            vec!["--loader", "./loader.mjs", "--inspect=9230", "app.js"],
            vec!["--diagnostic-dir", "/tmp", "--inspect=9230", "app.js"],
            vec!["--icu-data-dir", "/tmp", "--inspect=9230", "app.js"],
            vec!["--cpu-prof", "--cpu-prof-dir", "/tmp", "--inspect=9230"],
            vec!["--heap-prof", "--heap-prof-dir", "/tmp", "--inspect=9230"],
            vec![
                "--trace-event-categories",
                "node",
                "--inspect=9230",
                "-e",
                "",
            ],
        ] {
            assert_eq!(
                parse(&arguments),
                Ok(Some(LoopbackInspectorEndpoint {
                    host: LoopbackHost::Ipv4,
                    port: 9_230
                })),
                "{arguments:?}"
            );
        }
    }

    #[test]
    fn inspector_configuration_follows_ordered_last_setting_semantics() {
        for (arguments, port) in [
            (
                vec!["--inspect=9230", "--inspect-port=9231", "app.js"],
                9_231,
            ),
            (
                vec!["--inspect-port=9232", "--inspect=9233", "app.js"],
                9_233,
            ),
            (
                vec!["--inspect=9234", "--inspect-brk=9235", "app.js"],
                9_235,
            ),
            (vec!["--inspect-port=9236", "--inspect", "app.js"], 9_236),
            (vec!["--inspect", "--inspect-wait=9237", "app.js"], 9_237),
            (vec!["--debug-port", "9238", "--inspect", "app.js"], 9_238),
            (vec!["--debug-port=9239", "--inspect", "app.js"], 9_239),
            (
                vec!["--inspect=0.0.0.0:9240", "--inspect=127.0.0.1:9241"],
                9_241,
            ),
            (vec!["--inspect=0", "--inspect=9242"], 9_242),
        ] {
            assert_eq!(
                parse(&arguments),
                Ok(Some(LoopbackInspectorEndpoint {
                    host: LoopbackHost::Ipv4,
                    port
                })),
                "{arguments:?}"
            );
        }
    }

    #[test]
    fn host_only_loopback_forms_keep_network_authority() {
        for (argument, host) in [
            ("--inspect=localhost", LoopbackHost::Localhost),
            ("--inspect-brk=[::1]", LoopbackHost::Ipv6),
            ("--inspect-wait=127.0.0.1", LoopbackHost::Ipv4),
        ] {
            assert_eq!(
                parse(&[argument]),
                Ok(Some(LoopbackInspectorEndpoint {
                    host,
                    port: DEFAULT_INSPECTOR_PORT,
                }))
            );
        }
        assert_ne!(
            parse(&["--inspect=127.0.0.1:9233"]),
            parse(&["--inspect=[::1]:9233"])
        );
    }

    #[test]
    fn inspector_configuration_is_loopback_and_prefix_bounded() {
        for arguments in [
            vec!["--inspect=0", "app.js"],
            vec!["--inspect=0.0.0.0:9229", "app.js"],
            vec!["--inspect-port=bad", "--inspect", "app.js"],
        ] {
            assert_eq!(
                parse(&arguments),
                Err(NodeInspectorArgvFailure::InvalidInspectorConfiguration),
                "{arguments:?}"
            );
        }
        let oversized = vec![b'x'; MAX_PROCESS_ARG_BYTES + 1];
        assert_eq!(
            parse_node_inspector_argv(b"/usr/bin/node", &[oversized]),
            Err(NodeInspectorArgvFailure::ArgumentTooLarge)
        );
    }

    #[test]
    fn opaque_application_tail_cannot_poison_a_valid_candidate() {
        let oversized = vec![b'x'; MAX_PROCESS_ARG_BYTES + 1];
        assert_eq!(
            parse_node_inspector_argv(
                b"/usr/bin/node",
                &[b"--inspect=9230".to_vec(), b"app.js".to_vec(), oversized]
            ),
            Ok(Some(LoopbackInspectorEndpoint {
                host: LoopbackHost::Ipv4,
                port: 9_230
            }))
        );
        assert_eq!(
            parse_node_inspector_argv(
                b"/usr/bin/node",
                &[b"--inspect=9230".to_vec(), b"app.js".to_vec(), vec![0xff]]
            ),
            Ok(Some(LoopbackInspectorEndpoint {
                host: LoopbackHost::Ipv4,
                port: 9_230
            }))
        );
    }

    #[test]
    fn truncated_option_prefix_cannot_hide_a_later_last_wins_override() {
        let mut retained_prefix = vec![b"--inspect=9230".to_vec()];
        retained_prefix.extend((1..MAX_PROCESS_OPTION_COUNT).map(|_| b"--inspect=9230".to_vec()));
        let snapshot = VerifiedProcessSnapshot {
            process_id: 41,
            process_group_id: 40,
            start_seconds: 1_000,
            start_microseconds: 5,
            process_image: b"/verified/bin/node".to_vec(),
            arguments: retained_prefix,
            arguments_capture: ProcessArgumentsCapture::Truncated,
        };

        assert!(matches!(
            parse_verified_node_inspector(snapshot),
            Err(NodeInspectorArgvFailure::IncompleteArguments)
        ));

        let bounded_snapshot = VerifiedProcessSnapshot {
            process_id: 41,
            process_group_id: 40,
            start_seconds: 1_000,
            start_microseconds: 5,
            process_image: b"/verified/bin/node".to_vec(),
            arguments: argv(&["--inspect=9230", "app.js"]),
            arguments_capture: ProcessArgumentsCapture::Truncated,
        };
        assert!(parse_verified_node_inspector(bounded_snapshot)
            .expect("fixed script boundary")
            .is_some());
    }

    #[test]
    fn option_prefix_and_image_limits_are_exact() {
        let mut accepted_count = vec![b"--inspect".to_vec()];
        accepted_count.extend((1..MAX_PROCESS_OPTION_COUNT).map(|_| b"-x".to_vec()));
        assert_eq!(
            parse_node_inspector_argv(b"/usr/bin/node", &accepted_count),
            Ok(Some(LoopbackInspectorEndpoint {
                host: LoopbackHost::Ipv4,
                port: 9_229
            }))
        );
        accepted_count.push(b"-x".to_vec());
        assert_eq!(
            parse_node_inspector_argv(b"/usr/bin/node", &accepted_count),
            Err(NodeInspectorArgvFailure::TooManyArguments)
        );

        let mut exact_image = vec![b'/'; MAX_PROCESS_IMAGE_BYTES - b"node".len()];
        exact_image.extend_from_slice(b"node");
        assert!(parse_node_inspector_argv(&exact_image, &argv(&["--inspect"])).is_ok());
        exact_image.insert(0, b'/');
        assert_eq!(
            parse_node_inspector_argv(&exact_image, &argv(&["--inspect"])),
            Err(NodeInspectorArgvFailure::ProcessImageTooLarge)
        );

        let trigger = b"--inspect".to_vec();
        let remaining = MAX_PROCESS_OPTION_BYTES - trigger.len();
        let mut exact_aggregate = vec![trigger];
        exact_aggregate.extend(std::iter::repeat_n(
            vec![b'-'; MAX_PROCESS_ARG_BYTES],
            remaining / MAX_PROCESS_ARG_BYTES,
        ));
        let remainder = remaining % MAX_PROCESS_ARG_BYTES;
        if remainder > 0 {
            exact_aggregate.push(vec![b'-'; remainder]);
        }
        assert_eq!(
            parse_node_inspector_argv(b"/usr/bin/node", &exact_aggregate),
            Ok(Some(LoopbackInspectorEndpoint {
                host: LoopbackHost::Ipv4,
                port: 9_229
            }))
        );
        exact_aggregate.push(b"-".to_vec());
        assert_eq!(
            parse_node_inspector_argv(b"/usr/bin/node", &exact_aggregate),
            Err(NodeInspectorArgvFailure::ArgumentsTooLarge)
        );
    }

    #[test]
    fn stale_process_generation_or_endpoint_cannot_revalidate_candidate() {
        fn snapshot(start_seconds: u64, arguments: &[&str]) -> VerifiedProcessSnapshot {
            VerifiedProcessSnapshot {
                process_id: 41,
                process_group_id: 40,
                start_seconds,
                start_microseconds: 5,
                process_image: b"/verified/bin/node".to_vec(),
                arguments: argv(arguments),
                arguments_capture: ProcessArgumentsCapture::Complete,
            }
        }

        let candidate = parse_verified_node_inspector(snapshot(1_000, &["--inspect=9230"]))
            .expect("parse")
            .expect("candidate");
        assert!(candidate
            .revalidate(snapshot(1_001, &["--inspect=9230"]))
            .is_err());

        let candidate = parse_verified_node_inspector(snapshot(1_000, &["--inspect=9230"]))
            .expect("parse")
            .expect("candidate");
        assert!(candidate
            .revalidate(snapshot(1_000, &["--inspect=9231"]))
            .is_err());

        let candidate = parse_verified_node_inspector(snapshot(1_000, &["--inspect=[::1]:9230"]))
            .expect("parse")
            .expect("candidate");
        assert!(candidate
            .revalidate(snapshot(1_000, &["--inspect=127.0.0.1:9230"]))
            .is_err());
    }
}
