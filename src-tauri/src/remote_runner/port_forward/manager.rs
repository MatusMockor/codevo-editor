use super::{
    local_port,
    registry::{
        ForwardKey, ForwardSet, OwnerAuthority, OwnerLease, PortClaim, PortForwardRegistry, Probe,
        Reservation, CHANGED, STALE_OWNER,
    },
    ssh_forward::{ForwardPlan, ForwardProcess, ForwardProgram, RemoteLoopback},
    wire::{
        url_path, ListedPort, ListeningPort, PortAddress, PortList, PortListing, PortScheme,
        PortScope,
    },
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) const RUNNER_PORT: u16 = 4318;
pub(super) const READY_TIMEOUT: Duration = Duration::from_secs(10);
const READY_POLL: Duration = Duration::from_millis(50);
const SCOPE_GONE: &str = "Runner request failed (HTTP 404).";
const NO_LOCAL_PORT: &str = "No free local port is available for forwarding.";

pub(super) struct ForwardContext<'a> {
    pub(super) forwards: &'a ForwardSet,
    pub(super) registry: &'a Arc<PortForwardRegistry>,
    pub(super) authority: &'a dyn OwnerAuthority,
    pub(super) program: &'a dyn ForwardProgram,
    pub(super) connection_current: &'a dyn Fn() -> bool,
    pub(super) listing: &'a dyn Fn(&PortScope) -> Result<PortList, String>,
    pub(super) ready_timeout: Duration,
}

pub(super) struct PortTarget<'a> {
    pub(super) owner: &'a OwnerLease,
    pub(super) scope: &'a PortScope,
}

pub(super) struct OpenTarget<'a> {
    pub(super) port: u16,
    pub(super) scheme: PortScheme,
    pub(super) path: &'a str,
}

enum Readiness {
    Ready,
    Exited,
    Canceled,
    TimedOut,
}

struct PendingSlot<'a> {
    forwards: &'a ForwardSet,
    id: u64,
}

impl Drop for PendingSlot<'_> {
    fn drop(&mut self) {
        self.forwards.abandon(self.id);
    }
}

impl ForwardContext<'_> {
    fn current(&self, owner: &OwnerLease) -> bool {
        (self.connection_current)() && self.authority.is_live(owner)
    }

    fn admit(&self, owner: &OwnerLease) -> Result<(), String> {
        if !self.authority.is_live(owner) {
            return Err(STALE_OWNER.into());
        }
        Ok(())
    }

    fn fetch(&self, owner: &OwnerLease, scope: &PortScope) -> Result<PortList, String> {
        let mut list = (self.listing)(scope)?;
        if !self.current(owner) {
            return Err(CHANGED.into());
        }
        list.ports.retain(|port| port.port != RUNNER_PORT);
        Ok(list)
    }
}

fn listed_ports(list: &PortList) -> Option<Vec<u16>> {
    if list.truncated {
        return None;
    }
    Some(list.ports.iter().map(|port| port.port).collect())
}

pub(super) fn list(
    ctx: &ForwardContext<'_>,
    target: &PortTarget<'_>,
    now: Instant,
) -> Result<PortListing, String> {
    ctx.admit(target.owner)?;
    ctx.forwards.retire_dead(ctx.authority);
    let list = ctx.fetch(target.owner, target.scope)?;
    let forwards = ctx.forwards.reconcile(
        target.owner,
        target.scope,
        listed_ports(&list).as_deref(),
        now,
    );
    sweep_stale_scope(ctx, target, now);
    if !ctx.current(target.owner) {
        return Err(CHANGED.into());
    }
    Ok(PortListing {
        ports: list
            .ports
            .into_iter()
            .map(|port| {
                let forward = forwards
                    .iter()
                    .find(|(listed, _)| *listed == port.port)
                    .map(|(_, forward)| *forward);
                ListedPort {
                    port: port.port,
                    address: port.address,
                    source: port.source,
                    process: port.process,
                    forward,
                }
            })
            .collect(),
        truncated: list.truncated,
        scanned_at: list.scanned_at,
    })
}

fn sweep_stale_scope(ctx: &ForwardContext<'_>, target: &PortTarget<'_>, now: Instant) {
    let Some(scope) = ctx.forwards.stale_scope(target.owner, target.scope, now) else {
        return;
    };
    let listed = match ctx.fetch(target.owner, &scope) {
        Ok(list) => listed_ports(&list),
        Err(error) if error == SCOPE_GONE && ctx.current(target.owner) => Some(Vec::new()),
        Err(_) => return,
    };
    ctx.forwards
        .reconcile(target.owner, &scope, listed.as_deref(), now);
}

pub(super) fn open(
    ctx: &ForwardContext<'_>,
    target: &PortTarget<'_>,
    request: &OpenTarget<'_>,
    open_url: &dyn Fn(&str) -> Result<(), String>,
) -> Result<u16, String> {
    browser_url(request.scheme, request.port, request.path)?;
    ctx.admit(target.owner)?;
    ctx.forwards.retire_dead(ctx.authority);
    let list = ctx.fetch(target.owner, target.scope)?;
    let loopback = loopback_for(&list.ports, request.port).ok_or_else(|| {
        format!(
            "Nothing is listening on port {} for this server conversation.",
            request.port
        )
    })?;
    let key = ForwardKey {
        owner: target.owner.clone(),
        scope: target.scope.clone(),
        port: request.port,
    };
    let local = match ctx
        .forwards
        .reserve(ctx.registry, &key, loopback, Instant::now())?
    {
        Reservation::Open(local) => local,
        Reservation::Pending(id) => start(ctx, &key, id, loopback)?,
    };
    if !ctx.current(target.owner) {
        ctx.forwards.remove(&key);
        return Err(CHANGED.into());
    }
    open_url(&browser_url(request.scheme, local, request.path)?)?;
    Ok(local)
}

fn loopback_for(ports: &[ListeningPort], port: u16) -> Option<RemoteLoopback> {
    let families: Vec<PortAddress> = ports
        .iter()
        .filter(|listed| listed.port == port)
        .map(|listed| listed.address)
        .collect();
    if families.is_empty() {
        return None;
    }
    if families
        .iter()
        .any(|address| matches!(address, PortAddress::LoopbackV4 | PortAddress::AnyV4))
    {
        return Some(RemoteLoopback::V4);
    }
    Some(RemoteLoopback::V6)
}

fn claim_available(registry: &Arc<PortForwardRegistry>, port: u16) -> Option<PortClaim> {
    let claim = registry.claim(port)?;
    local_port::available(port).then_some(claim)
}

fn claim_ephemeral(registry: &Arc<PortForwardRegistry>) -> Result<PortClaim, String> {
    for _ in 0..8 {
        if let Some(claim) = claim_available(registry, local_port::ephemeral()?) {
            return Ok(claim);
        }
    }
    Err(NO_LOCAL_PORT.into())
}

fn claim_local(registry: &Arc<PortForwardRegistry>, remote: u16) -> Result<PortClaim, String> {
    if let Some(claim) = claim_available(registry, remote) {
        return Ok(claim);
    }
    claim_ephemeral(registry)
}

fn start(
    ctx: &ForwardContext<'_>,
    key: &ForwardKey,
    id: u64,
    loopback: RemoteLoopback,
) -> Result<u16, String> {
    let _slot = PendingSlot {
        forwards: ctx.forwards,
        id,
    };
    let mut claim = claim_local(ctx.registry, key.port)?;
    let mut retried = false;
    loop {
        let local = claim.port();
        let plan = ForwardPlan {
            destination: ctx.forwards.destination(),
            local_port: local,
            target: loopback,
            remote_port: key.port,
        };
        let process = ForwardProcess::spawn(ctx.program.command(&plan))?;
        ctx.forwards.attach(id, claim, process)?;
        match wait_ready(ctx, key, id, local) {
            Readiness::Ready => break,
            Readiness::Exited if !retried && local_port::occupied(local) => {
                retried = true;
                claim = claim_ephemeral(ctx.registry)?;
            }
            Readiness::Exited => {
                return Err("SSH port forward failed. Check SSH access to the server.".into())
            }
            Readiness::Canceled => return Err(CHANGED.into()),
            Readiness::TimedOut => {
                return Err("SSH port forward did not become ready in time.".into())
            }
        }
    }
    if !ctx.current(&key.owner) {
        return Err(CHANGED.into());
    }
    let local = ctx.forwards.mark_ready(id)?;
    if !ctx.authority.is_live(&key.owner) {
        ctx.forwards.discard(id);
        return Err(STALE_OWNER.into());
    }
    Ok(local)
}

fn readiness(probe: Probe) -> Option<Readiness> {
    match probe {
        Probe::Running => None,
        Probe::Exited => Some(Readiness::Exited),
        Probe::Gone => Some(Readiness::Canceled),
    }
}

fn wait_ready(ctx: &ForwardContext<'_>, key: &ForwardKey, id: u64, local: u16) -> Readiness {
    let started = Instant::now();
    loop {
        if !ctx.current(&key.owner) {
            return Readiness::Canceled;
        }
        if let Some(settled) = readiness(ctx.forwards.probe(id)) {
            return settled;
        }
        if local_port::accepting(local) {
            std::thread::sleep(READY_POLL);
            return readiness(ctx.forwards.probe(id)).unwrap_or(Readiness::Ready);
        }
        if started.elapsed() >= ctx.ready_timeout {
            return Readiness::TimedOut;
        }
        std::thread::sleep(READY_POLL);
    }
}

pub(super) fn browser_url(scheme: PortScheme, local: u16, path: &str) -> Result<String, String> {
    url_path(path)?;
    let invalid = || "Invalid server port path".to_string();
    let scheme = match scheme {
        PortScheme::Http => "http",
        PortScheme::Https => "https",
    };
    let url =
        url::Url::parse(&format!("{scheme}://127.0.0.1:{local}{path}")).map_err(|_| invalid())?;
    if url.host_str() != Some("127.0.0.1")
        || url.port() != Some(local)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    Ok(url.into())
}
