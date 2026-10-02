use super::manager::{self, ForwardContext, OpenTarget, PortTarget};
use super::registry::{OwnerAuthority, OwnerLease, PortForwardRegistry};
use super::ssh_forward::{ForwardPlan, ForwardProgram, RemoteLoopback};
use super::wire::{
    ListeningPort, PortAddress, PortList, PortListing, PortScheme, PortScope, PortSource,
};
use crate::remote_runner::transport::Session;
use std::{
    collections::HashSet,
    net::{Ipv4Addr, TcpListener},
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const LISTENER: &str = "import os,socket,subprocess,sys,time\nif sys.argv[3]:\n    open(sys.argv[3],'w').write(str(os.getpid()))\ntime.sleep(float(sys.argv[2]))\ns=socket.socket()\ns.bind(('127.0.0.1',int(sys.argv[1])))\ns.listen(16)\nsubprocess.Popen(['sleep','60'])\nwhile True:\n    c,_=s.accept()\n    c.close()";

pub(super) const TASK_A: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
pub(super) const TASK_B: &str = "5a0c43a8-6c1e-4b8e-9c38-3f3a3c7d8e21";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Behaviour {
    Listen,
    CollideFirst,
}

pub(super) struct FakeProgram {
    pub(super) behaviour: Behaviour,
    pub(super) delay: Mutex<f32>,
    pub(super) pid_file: Option<PathBuf>,
    pub(super) plans: Mutex<Vec<(u16, RemoteLoopback, u16)>>,
    pub(super) blockers: Mutex<Vec<TcpListener>>,
}

impl FakeProgram {
    pub(super) fn new(behaviour: Behaviour) -> Self {
        Self {
            behaviour,
            delay: Mutex::new(0.0),
            pid_file: None,
            plans: Mutex::new(Vec::new()),
            blockers: Mutex::new(Vec::new()),
        }
    }

    pub(super) fn calls(&self) -> usize {
        self.plans.lock().unwrap().len()
    }
}

impl ForwardProgram for FakeProgram {
    fn command(&self, plan: &ForwardPlan<'_>) -> Command {
        let mut plans = self.plans.lock().unwrap();
        plans.push((plan.local_port, plan.target, plan.remote_port));
        if self.behaviour == Behaviour::CollideFirst && plans.len() == 1 {
            let blocker = TcpListener::bind((Ipv4Addr::LOCALHOST, plan.local_port)).unwrap();
            self.blockers.lock().unwrap().push(blocker);
            return Command::new("/usr/bin/false");
        }
        let mut command = Command::new("python3");
        command.args([
            "-c",
            LISTENER,
            &plan.local_port.to_string(),
            &self.delay.lock().unwrap().to_string(),
            &self
                .pid_file
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_default(),
        ]);
        command
    }
}

#[derive(Default)]
pub(super) struct FakeAuthority {
    revoked: Mutex<HashSet<OwnerLease>>,
}

impl FakeAuthority {
    pub(super) fn revoke(&self, owner: &OwnerLease) {
        self.revoked.lock().unwrap().insert(owner.clone());
    }
}

impl OwnerAuthority for FakeAuthority {
    fn is_live(&self, owner: &OwnerLease) -> bool {
        !self.revoked.lock().unwrap().contains(owner)
    }
}

pub(super) struct Harness {
    pub(super) session: Session,
    pub(super) registry: Arc<PortForwardRegistry>,
    pub(super) authority: FakeAuthority,
    pub(super) program: FakeProgram,
    pub(super) ports: Mutex<Vec<(PortScope, u16, PortAddress)>>,
    pub(super) connected: AtomicBool,
    pub(super) truncated: AtomicBool,
    pub(super) gone: Mutex<Vec<PortScope>>,
    pub(super) listings: AtomicUsize,
    pub(super) opened: Mutex<Vec<String>>,
}

impl Harness {
    pub(super) fn new(behaviour: Behaviour) -> Self {
        Self::with_registry(behaviour, Arc::default())
    }

    pub(super) fn with_registry(behaviour: Behaviour, registry: Arc<PortForwardRegistry>) -> Self {
        Self {
            session: Session::fixture(),
            registry,
            authority: FakeAuthority::default(),
            program: FakeProgram::new(behaviour),
            ports: Mutex::new(Vec::new()),
            connected: AtomicBool::new(true),
            truncated: AtomicBool::new(false),
            gone: Mutex::new(Vec::new()),
            listings: AtomicUsize::new(0),
            opened: Mutex::new(Vec::new()),
        }
    }

    pub(super) fn release_retired(&self, owner_id: &str) {
        self.registry.release_retired(owner_id, &self.authority);
    }

    pub(super) fn listen(&self, scope: &PortScope, port: u16, address: PortAddress) {
        let mut ports = self.ports.lock().unwrap();
        ports.push((scope.clone(), port, address));
        ports.sort_by_key(|(_, port, address)| (*port, *address));
    }

    pub(super) fn stop_listening(&self) {
        self.ports.lock().unwrap().clear();
    }

    fn listing(&self, scope: &PortScope) -> Result<PortList, String> {
        self.listings.fetch_add(1, Ordering::SeqCst);
        if self.gone.lock().unwrap().contains(scope) {
            return Err("Runner request failed (HTTP 404).".into());
        }
        Ok(PortList {
            ports: self
                .ports
                .lock()
                .unwrap()
                .iter()
                .filter(|(listed, _, _)| listed == scope)
                .map(|(_, port, address)| ListeningPort {
                    port: *port,
                    address: *address,
                    source: PortSource::Agent,
                    process: "node".into(),
                })
                .collect(),
            truncated: self.truncated.load(Ordering::SeqCst),
            scanned_at: "2026-10-02T09:15:00.000Z".into(),
        })
    }

    fn with<T>(&self, work: impl FnOnce(&ForwardContext<'_>) -> T) -> T {
        let connected = || self.connected.load(Ordering::SeqCst);
        let listing = |scope: &PortScope| self.listing(scope);
        work(&ForwardContext {
            forwards: self.session.forwards(),
            registry: &self.registry,
            authority: &self.authority,
            program: &self.program,
            connection_current: &connected,
            listing: &listing,
            ready_timeout: Duration::from_secs(5),
        })
    }

    pub(super) fn open(
        &self,
        owner: &OwnerLease,
        scope: &PortScope,
        port: u16,
    ) -> Result<u16, String> {
        let open_url = |url: &str| {
            self.opened.lock().unwrap().push(url.into());
            Ok(())
        };
        self.with(|ctx| {
            manager::open(
                ctx,
                &PortTarget { owner, scope },
                &OpenTarget {
                    port,
                    scheme: PortScheme::Http,
                    path: "/",
                },
                &open_url,
            )
        })
    }

    pub(super) fn list_at(
        &self,
        owner: &OwnerLease,
        scope: &PortScope,
        now: Instant,
    ) -> Result<PortListing, String> {
        self.with(|ctx| manager::list(ctx, &PortTarget { owner, scope }, now))
    }

    pub(super) fn pids(&self) -> Vec<u32> {
        self.session.forwards().forward_pids()
    }
}

pub(super) fn owner(id: &str, generation: u64) -> OwnerLease {
    OwnerLease {
        id: id.into(),
        generation,
    }
}

pub(super) fn task(id: &str) -> PortScope {
    PortScope::Task { task_id: id.into() }
}

pub(super) fn free_port() -> u16 {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub(super) fn group_gone(pid: u32) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) {
        if unsafe { libc::kill(-(pid as i32), 0) } == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

pub(super) fn group_alive(pid: u32) -> bool {
    unsafe { libc::kill(-(pid as i32), 0) == 0 }
}

pub(super) fn wait_for(condition: impl Fn() -> bool) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}
