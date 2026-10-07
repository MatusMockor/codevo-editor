use super::*;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::atomic::AtomicU64;

#[derive(Default)]
struct FakeClock {
    elapsed: Cell<Duration>,
    waits: RefCell<Vec<Duration>>,
    on_wait: RefCell<Option<Box<dyn FnMut()>>>,
}

impl DigestClock for Rc<FakeClock> {
    fn elapsed(&self) -> Duration {
        let elapsed = self.elapsed.get();
        self.elapsed.set(elapsed + MAINTENANCE_WORK_BURST);
        elapsed
    }

    fn wait(&self, duration: Duration) {
        self.waits.borrow_mut().push(duration);
        self.elapsed.set(self.elapsed.get() + duration);
        if let Some(on_wait) = self.on_wait.borrow_mut().as_mut() {
            on_wait();
        }
    }
}

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NONCE: AtomicU64 = AtomicU64::new(0);
        let path = env::temp_dir().join(format!(
            "codevo-digest-budget-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::write(&path, vec![42; 256 * 1024]).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_file(&self.0).unwrap();
    }
}

#[test]
fn maintenance_yields_in_small_cancellable_steps_with_bounded_total_wait() {
    let clock = Rc::new(FakeClock::default());
    let mut budget =
        ExecutableDigestBudget::with_clock(ExecutableValidationEffort::Maintenance, clock.clone());
    for _ in 0..400 {
        budget.checkpoint(&|| false).unwrap();
    }
    let waits = clock.waits.borrow();
    assert_eq!(
        waits.iter().copied().sum::<Duration>(),
        MAX_MAINTENANCE_WAIT
    );
    assert!(waits.iter().all(|wait| *wait <= CANCELLATION_POLL));
}

#[test]
fn interactive_validation_never_waits() {
    let clock = Rc::new(FakeClock::default());
    let mut budget =
        ExecutableDigestBudget::with_clock(ExecutableValidationEffort::Interactive, clock.clone());
    for _ in 0..400 {
        budget.checkpoint(&|| false).unwrap();
    }
    assert!(clock.waits.borrow().is_empty());
}

#[test]
fn paced_digest_reads_every_byte_and_matches_interactive_digest() {
    let fixture = Fixture::new();
    let descriptor = fs::File::open(&fixture.0).unwrap();
    let size = descriptor.metadata().unwrap().len();
    let expected = executable_digest(&descriptor, size).unwrap();
    let clock = Rc::new(FakeClock::default());
    let mut budget =
        ExecutableDigestBudget::with_clock(ExecutableValidationEffort::Maintenance, clock.clone());
    take_executable_digest_work();
    assert_eq!(
        digest_with_budget(&descriptor, size, || false, &mut budget).unwrap(),
        expected
    );
    assert_eq!(take_executable_digest_work(), (1, size));
    assert!(!clock.waits.borrow().is_empty());
}

#[test]
fn cancellation_during_wait_stops_before_reading_more_bytes() {
    let fixture = Fixture::new();
    let descriptor = fs::File::open(&fixture.0).unwrap();
    let clock = Rc::new(FakeClock::default());
    let mut budget =
        ExecutableDigestBudget::with_clock(ExecutableValidationEffort::Maintenance, clock.clone());
    take_executable_digest_work();
    assert!(digest_with_budget(
        &descriptor,
        descriptor.metadata().unwrap().len(),
        || !clock.waits.borrow().is_empty(),
        &mut budget,
    )
    .is_err());
    assert_eq!(clock.waits.borrow().len(), 1);
    assert_eq!(take_executable_digest_work(), (1, 0));
}

#[cfg(unix)]
#[test]
fn mutation_during_maintenance_wait_fails_exact_validation() {
    let fixture = Fixture::new();
    let identity = executable_identity(fixture.0.to_str().unwrap()).unwrap();
    let clock = Rc::new(FakeClock::default());
    let path = fixture.0.clone();
    *clock.on_wait.borrow_mut() = Some(Box::new(move || {
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        let mut file = fs::File::options().write(true).open(&path).unwrap();
        file.write_all(&[43]).unwrap();
        file.set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }));
    let mut budget =
        ExecutableDigestBudget::with_clock(ExecutableValidationEffort::Maintenance, clock);
    assert!(!identity.exact_shallow_is_current_with_budget(|| false, &mut budget));
}

#[cfg(unix)]
#[test]
fn maintenance_entry_executes_read_only_probes_and_rejects_updates() {
    let identity = executable_identity("/usr/bin/true").unwrap();
    let path = env::var("PATH").unwrap();
    let probe = AgentProviderProcessPlan::provider_owned_with_effective_path(
        identity.clone(),
        AgentProviderProcessIntent::InstalledVersion(AgentCliInvocation::ClaudeCode),
        &path,
    )
    .unwrap();
    assert!(execute_agent_provider_maintenance_plan_cancellable(&probe, || false).is_ok());
    let update = AgentProviderProcessPlan::provider_owned_with_effective_path(
        identity,
        AgentProviderProcessIntent::SelfUpdate(AgentCliInvocation::ClaudeCode),
        &path,
    )
    .unwrap();
    take_executable_digest_work();
    assert!(matches!(
        execute_agent_provider_maintenance_plan_cancellable(&update, || false),
        Err(AgentProviderProcessFailure::Uncertain(_))
    ));
    assert_eq!(take_executable_digest_work(), (0, 0));
}

#[test]
fn deadline_reached_during_wait_stops_validation() {
    let fixture = Fixture::new();
    let descriptor = fs::File::open(&fixture.0).unwrap();
    let clock = Rc::new(FakeClock::default());
    let mut budget =
        ExecutableDigestBudget::with_clock(ExecutableValidationEffort::Maintenance, clock.clone());
    let deadline = Duration::from_millis(3);
    assert!(digest_with_budget(
        &descriptor,
        descriptor.metadata().unwrap().len(),
        || clock.elapsed.get() >= deadline,
        &mut budget,
    )
    .is_err());
    assert_eq!(clock.waits.borrow().as_slice(), &[CANCELLATION_POLL]);
}

#[cfg(unix)]
#[test]
fn an_executable_is_fingerprinted_at_the_size_cap_and_rejected_above_it_without_hashing() {
    assert_eq!(MAX_PROVIDER_EXECUTABLE_BYTES, 512 * 1024 * 1024);
    let fixture = Fixture::new();
    let path = fixture.0.to_str().unwrap();
    let file = fs::File::options().write(true).open(&fixture.0).unwrap();
    file.set_len(MAX_PROVIDER_EXECUTABLE_BYTES).unwrap();
    take_executable_digest_work();
    let identity = executable_identity(path).unwrap();
    assert_eq!(identity.size_bytes, MAX_PROVIDER_EXECUTABLE_BYTES);
    assert_eq!(
        take_executable_digest_work(),
        (1, MAX_PROVIDER_EXECUTABLE_BYTES)
    );
    file.set_len(MAX_PROVIDER_EXECUTABLE_BYTES + 1).unwrap();
    assert_eq!(
        executable_identity(path).err().as_deref(),
        Some("Provider executable is too large.")
    );
    assert_eq!(take_executable_digest_work(), (0, 0));
    assert!(!identity.is_current_for_spawn());
}
