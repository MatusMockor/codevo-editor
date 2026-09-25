use super::{
    directory::Destination,
    failure::CloneFailure,
    progress::CloneProgress,
    trust_revocation::CloneTrustRevocation,
    wire::{valid_id, CloneRequest, Snapshot, Status},
};
#[cfg(unix)]
use super::{
    failure::classify_failure,
    git_environment::{GitEnvironment, SshTransport},
    process::{run_bounded, ProcessError, ProcessLimits},
    process_guard::ProcessKillSwitch,
    progress::CloneOutputReader,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard, PoisonError,
};

const MAX_JOBS: usize = 64;
const MAX_ACTIVE: usize = 2;
#[derive(Clone, Default)]
pub(crate) struct LocalCloneState(Arc<Registry>);
#[derive(Default)]
struct Registry {
    jobs: Mutex<Vec<Arc<Job>>>,
    starting: AtomicBool,
    closed: AtomicBool,
}
struct Job {
    request: CloneRequest,
    snapshot: Mutex<Snapshot>,
    failure: Mutex<Option<CloneFailure>>,
    active: AtomicBool,
    cancelled: AtomicBool,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
    #[cfg(unix)]
    kill: ProcessKillSwitch,
}
fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}
impl Drop for Registry {
    fn drop(&mut self) {
        let jobs = std::mem::take(self.jobs.get_mut().unwrap_or_else(PoisonError::into_inner));
        for job in &jobs {
            job.stop();
        }
        for job in jobs {
            if let Some(worker) = lock(&job.worker).take() {
                let _ = worker.join();
            }
        }
    }
}
impl Job {
    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        #[cfg(unix)]
        self.kill.kill();
    }
    fn snapshot(&self) -> Snapshot {
        lock(&self.snapshot).clone()
    }
    pub(super) fn publish_progress(&self, progress: CloneProgress) {
        let mut state = lock(&self.snapshot);
        if state.status == Status::Running && state.progress != Some(progress) {
            state.progress = Some(progress);
        }
    }
    pub(super) fn record_failure(&self, failure: CloneFailure) {
        *lock(&self.failure) = Some(failure);
    }
}
impl LocalCloneState {
    pub(crate) fn get(&self, id: &str) -> Result<Snapshot, String> {
        Ok(self.find(id)?.snapshot())
    }
    fn find(&self, id: &str) -> Result<Arc<Job>, String> {
        if !valid_id(id) {
            return Err("Invalid clone identity.".into());
        }
        lock(&self.0.jobs)
            .iter()
            .find(|j| j.request.idempotency_key == id)
            .cloned()
            .ok_or_else(|| "The clone job is no longer available.".into())
    }
    pub(crate) fn cancel(&self, id: &str) -> Result<Snapshot, String> {
        let job = self.find(id)?;
        let state = lock(&job.snapshot);
        if state.status == Status::Running {
            job.stop();
        }
        Ok(state.clone())
    }
    pub(crate) fn shutdown(&self) -> Result<(), String> {
        self.0.closed.store(true, Ordering::SeqCst);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            // Closed admission plus a settled start gate makes this a complete
            // snapshot: no worker can be registered after it is captured.
            if self.0.starting.load(Ordering::SeqCst) {
                if std::time::Instant::now() >= deadline {
                    return Err("Local clone startup did not stop before shutdown.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            let jobs = lock(&self.0.jobs).clone();
            for job in &jobs {
                job.stop();
            }
            if jobs.iter().all(|job| !job.active.load(Ordering::SeqCst)) {
                for job in jobs {
                    if let Some(worker) = lock(&job.worker).take() {
                        let _ = worker.join();
                    }
                }
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err("Local clones did not stop before shutdown.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    pub(crate) fn start(
        &self,
        trust: &dyn CloneTrustRevocation,
        request: CloneRequest,
    ) -> Result<Snapshot, String> {
        self.start_with(trust, request, execute)
    }
    fn start_with<F>(
        &self,
        trust: &dyn CloneTrustRevocation,
        request: CloneRequest,
        execute: F,
    ) -> Result<Snapshot, String>
    where
        F: FnOnce(&Job, &Destination) -> Result<(), String> + Send + 'static,
    {
        request.validate()?;
        if self.0.closed.load(Ordering::SeqCst) {
            return Err("Local cloning is shutting down.".into());
        }
        // Admission is fail-fast while another start reserves its directory. No
        // global mutex is held across filesystem access or process work.
        if self.0.starting.swap(true, Ordering::SeqCst) {
            return Err("Another clone is starting. Try again.".into());
        }
        struct StartPermit<'a>(&'a AtomicBool);
        impl Drop for StartPermit<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _permit = StartPermit(&self.0.starting);
        if self.0.closed.load(Ordering::SeqCst) {
            return Err("Local cloning is shutting down.".into());
        }
        let existing = lock(&self.0.jobs)
            .iter()
            .find(|job| job.request.idempotency_key == request.idempotency_key)
            .cloned();
        if let Some(job) = existing {
            return if job.request == request {
                Ok(job.snapshot())
            } else {
                Err("This clone request was already used for another destination.".into())
            };
        }
        let evicted = {
            let mut jobs = lock(&self.0.jobs);
            if jobs
                .iter()
                .filter(|j| j.active.load(Ordering::SeqCst))
                .count()
                >= MAX_ACTIVE
            {
                return Err("Two clones are already running. Wait for one to finish.".into());
            }
            // Idempotency is retained for the newest 64 jobs in this app session.
            // Only settled workers can leave the registry, in insertion order.
            if jobs.len() >= MAX_JOBS {
                let index = jobs
                    .iter()
                    .position(|job| !job.active.load(Ordering::SeqCst))
                    .ok_or("The clone queue is full.")?;
                Some(jobs.remove(index))
            } else {
                None
            }
        };
        if let Some(job) = evicted {
            if let Some(worker) = lock(&job.worker).take() {
                let _ = worker.join();
            }
        }
        let destination = Arc::new(Destination::reserve(
            &request.parent_path,
            &request.name,
            request.ensure_parent,
        )?);
        let job = Arc::new(Job {
            snapshot: Mutex::new(Snapshot {
                clone_id: request.idempotency_key.clone(),
                status: Status::Running,
                path: Some(destination.path.clone()),
                error: None,
                progress: None,
                failure: None,
            }),
            failure: Mutex::new(None),
            request,
            active: AtomicBool::new(true),
            cancelled: AtomicBool::new(false),
            worker: Mutex::new(None),
            #[cfg(unix)]
            kill: ProcessKillSwitch::default(),
        });
        lock(&self.0.jobs).push(Arc::clone(&job));
        if let Err(error) = trust.revoke_clone_root(&destination.path) {
            job.record_failure(CloneFailure::Destination);
            settle(&job, &destination, Err(error));
            job.active.store(false, Ordering::SeqCst);
            return Ok(job.snapshot());
        }
        let worker = Arc::clone(&job);
        let worker_destination = Arc::clone(&destination);
        let handle = std::thread::Builder::new()
            .name("local-project-clone".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    execute(&worker, &worker_destination)
                }))
                .unwrap_or_else(|_| Err("Cloning stopped unexpectedly.".into()));
                settle(&worker, &worker_destination, result);
                worker.active.store(false, Ordering::SeqCst);
            });
        match handle {
            Ok(handle) => *lock(&job.worker) = Some(handle),
            Err(_) => {
                settle(&job, &destination, Err("Could not start cloning.".into()));
                job.active.store(false, Ordering::SeqCst);
            }
        }
        Ok(job.snapshot())
    }
}
fn settle(job: &Job, destination: &Destination, result: Result<(), String>) {
    // Finalization and cancel acceptance are serialized on this job, never the
    // registry. IPC snapshots run on the blocking pool while cleanup settles.
    let mut state = lock(&job.snapshot);
    let cancelled = job.cancelled.load(Ordering::SeqCst);
    state.progress = None;
    if (result.is_err() || cancelled) && destination.cleanup().is_err() {
        state.status = Status::Failed;
        state.path = None;
        state.failure = Some(CloneFailure::Destination);
        state.error = Some("Cloning stopped. The partial folder could not be removed; choose a different folder name before retrying.".into());
        return;
    }
    if cancelled {
        state.status = Status::Cancelled;
        state.path = None;
        return;
    }
    match result {
        Ok(()) => state.status = Status::Completed,
        Err(error) => {
            state.status = Status::Failed;
            state.path = None;
            state.failure = Some(lock(&job.failure).take().unwrap_or(CloneFailure::Other));
            state.error = Some(error);
        }
    }
}
#[cfg(unix)]
fn execute(job: &Job, destination: &Destination) -> Result<(), String> {
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(());
    }
    destination.verify()?;
    let environment = GitEnvironment::from_process()?;
    let transport = SshTransport::select(
        |key| std::env::var_os(key),
        || environment.user_configures_ssh_command(destination, &job.kill),
    );
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(());
    }
    let mut command = clone_command(&job.request, &environment, &transport);
    destination.anchor(&mut command);
    run_clone(job, destination, command)
}

#[cfg(unix)]
fn clone_command(
    request: &CloneRequest,
    environment: &GitEnvironment,
    transport: &SshTransport,
) -> std::process::Command {
    let mut argv = vec![
        "-c".into(),
        "core.hooksPath=/dev/null".into(),
        "-c".into(),
        "protocol.file.allow=never".into(),
        "-c".into(),
        "protocol.ext.allow=never".into(),
        "clone".into(),
        "--progress".into(),
        "--no-recurse-submodules".into(),
    ];
    if let Some(branch) = &request.branch {
        argv.extend(["--branch".into(), branch.clone()]);
    }
    argv.extend(["--".into(), request.url.clone(), ".".into()]);
    let mut command = environment.command(&argv);
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never");
    transport.apply(&mut command);
    command
}

#[cfg(unix)]
fn run_clone(
    job: &Job,
    destination: &Destination,
    command: std::process::Command,
) -> Result<(), String> {
    run_clone_with_timeout(
        job,
        destination,
        command,
        std::time::Duration::from_secs(1800),
    )
}

#[cfg(unix)]
fn run_clone_with_timeout(
    job: &Job,
    destination: &Destination,
    command: std::process::Command,
    timeout: std::time::Duration,
) -> Result<(), String> {
    let mut reader = CloneOutputReader::default();
    let output = run_bounded(
        command,
        ProcessLimits {
            timeout,
            stdout_bytes: 64 * 1024,
            stderr_bytes: 64 * 1024,
        },
        &job.kill,
        &mut |chunk| {
            if let Some(progress) = reader.push(chunk) {
                job.publish_progress(progress);
            }
        },
    );
    if let Some(progress) = reader.finish() {
        job.publish_progress(progress);
    }
    match output {
        Ok(output) if output.success => destination.verify().inspect_err(|_| {
            job.record_failure(CloneFailure::Destination);
        }),
        Err(ProcessError::TimedOut) => {
            job.record_failure(CloneFailure::Timeout);
            Err("Cloning timed out.".into())
        }
        _ => {
            job.record_failure(classify_failure(reader.diagnostics()));
            Err("Cloning failed. Check the repository address and local Git access.".into())
        }
    }
}
#[cfg(not(unix))]
fn execute(_job: &Job, _destination: &Destination) -> Result<(), String> {
    Err("Local cloning is not supported on this platform.".into())
}

#[cfg(all(test, unix))]
#[path = "tests.rs"]
mod tests;
