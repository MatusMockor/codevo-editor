use super::{
    CodexAppServerHost, CodexAppServerHostRegistry, CodexHostKey, CodexHostLaunchPlan,
    CodexHostProcess, CodexHostProcessSpawner, StdCodexHostProcess,
};
use crate::agent_task_spawner::agent_provider::process::executable_identity;
use crate::agent_task_spawner::codex_app_server_transport::CodexAppServerStreams;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(crate) const SHELL_HOST_DEADLINE: Duration = Duration::from_secs(10);

const TERM_IGNORING_APP_SERVER: &str = r#"trap '' TERM
sleep 300 >/dev/null 2>&1 &
echo "leader=$$ background=$!" >&2
requests=0
while IFS= read -r frame; do
  case "$frame" in
    *'"id":'*) requests=$((requests + 1)) ;;
    *) continue ;;
  esac
  case "$frame" in
    *'"thread/start"'*) echo "{\"id\":$requests,\"result\":{\"thread\":{\"id\":\"thread-$requests\"}}}" ;;
    *'"turn/start"'*) echo "{\"id\":$requests,\"result\":{\"turn\":{\"id\":\"turn-$requests\",\"status\":\"inProgress\"}}}" ;;
    *) echo "{\"id\":$requests,\"result\":{}}" ;;
  esac
done
wait
"#;

pub(crate) struct ShellHostStopGate {
    entered: Mutex<Sender<()>>,
    release: Mutex<Receiver<()>>,
    held: AtomicBool,
    released_in_time: AtomicBool,
}

pub(crate) struct ShellHostStopGateControl {
    gate: Arc<ShellHostStopGate>,
    entered: Receiver<()>,
    release: Sender<()>,
}

impl ShellHostStopGateControl {
    pub(crate) fn await_held_stop(&self) {
        self.entered
            .recv_timeout(SHELL_HOST_DEADLINE)
            .expect("the retired host never reached its process stop");
    }

    pub(crate) fn release_stop(&self) {
        self.release.send(()).expect("release the held stop");
    }

    pub(crate) fn released_in_time(&self) -> bool {
        self.gate.released_in_time.load(Ordering::SeqCst)
    }
}

impl ShellHostStopGate {
    fn hold(&self) {
        if self.held.swap(true, Ordering::SeqCst) {
            return;
        }
        self.entered
            .lock()
            .expect("entered lock")
            .send(())
            .expect("announce the held stop");
        let released = self
            .release
            .lock()
            .expect("release lock")
            .recv_timeout(SHELL_HOST_DEADLINE)
            .is_ok();
        self.released_in_time.store(released, Ordering::SeqCst);
    }
}

#[derive(Default)]
pub(crate) struct ShellHostSpawner {
    stop_gate: Option<Arc<ShellHostStopGate>>,
    first_stop_panics: Arc<AtomicBool>,
}

impl ShellHostSpawner {
    pub(crate) fn panicking_on_the_first_stop() -> Self {
        Self {
            stop_gate: None,
            first_stop_panics: Arc::new(AtomicBool::new(true)),
        }
    }

    pub(crate) fn holding_the_first_stop() -> (Self, ShellHostStopGateControl) {
        let (entered_tx, entered) = channel();
        let (release, release_rx) = channel();
        let gate = Arc::new(ShellHostStopGate {
            entered: Mutex::new(entered_tx),
            release: Mutex::new(release_rx),
            held: AtomicBool::new(false),
            released_in_time: AtomicBool::new(false),
        });
        let control = ShellHostStopGateControl {
            gate: Arc::clone(&gate),
            entered,
            release,
        };
        (
            Self {
                stop_gate: Some(gate),
                first_stop_panics: Arc::default(),
            },
            control,
        )
    }
}

struct ShellHostProcess {
    process: StdCodexHostProcess,
    stop_gate: Option<Arc<ShellHostStopGate>>,
    first_stop_panics: Arc<AtomicBool>,
}

impl CodexHostProcess for ShellHostProcess {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String> {
        self.process.take_streams()
    }

    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>> {
        self.process.take_stderr()
    }

    fn stop(&mut self, graceful: Duration, force: Duration) {
        if let Some(gate) = &self.stop_gate {
            gate.hold();
        }
        if self.first_stop_panics.swap(false, Ordering::SeqCst) {
            panic!("injected first stop fault");
        }
        self.process.stop(graceful, force);
    }
}

impl CodexHostProcessSpawner for ShellHostSpawner {
    fn spawn(&self, _plan: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String> {
        let child = Command::new("/bin/sh")
            .args(["-c", TERM_IGNORING_APP_SERVER])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(Box::new(ShellHostProcess {
            process: StdCodexHostProcess::adopt(child)?,
            stop_gate: self.stop_gate.clone(),
            first_stop_panics: Arc::clone(&self.first_stop_panics),
        }))
    }
}

pub(crate) fn shell_host_for(
    registry: &CodexAppServerHostRegistry,
    repository_root: &Path,
    trust_root: &Path,
) -> Result<Arc<CodexAppServerHost>, String> {
    let identity = executable_identity("/bin/sh").expect("identity for /bin/sh");
    let plan = CodexHostLaunchPlan::new(identity.clone(), repository_root, trust_root, &[], &[])?
        .with_env(Vec::new());
    registry.host_for(
        CodexHostKey::new(repository_root.to_path_buf(), 1, identity),
        &plan,
    )
}

pub(crate) struct ShellHostPids {
    pub(crate) leader: i32,
    pub(crate) background: i32,
}

impl ShellHostPids {
    pub(crate) fn of(host: &CodexAppServerHost) -> Self {
        let mut pids = None;
        assert!(
            within_deadline(|| {
                pids = reported_pids(&host.stderr_tail());
                pids.is_some()
            }),
            "the shell host never reported its process group"
        );
        let (leader, background) = pids.expect("reported pids");
        Self { leader, background }
    }

    pub(crate) fn alive(&self) -> bool {
        alive(self.leader) && alive(self.background)
    }

    pub(crate) fn gone_within_deadline(&self) -> bool {
        within_deadline(|| !alive(self.leader) && !alive(self.background))
    }
}

fn reported_pids(stderr: &str) -> Option<(i32, i32)> {
    let (line, _) = stderr.split_once('\n')?;
    let (leader, background) = line.strip_prefix("leader=")?.split_once(" background=")?;
    Some((leader.parse().ok()?, background.parse().ok()?))
}

fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

pub(crate) fn within_deadline(mut reached: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + SHELL_HOST_DEADLINE;
    loop {
        if reached() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
