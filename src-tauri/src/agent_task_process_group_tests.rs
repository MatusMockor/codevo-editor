use super::*;
use std::io::{self, Read};

#[derive(Default)]
struct RecordingSignals {
    sent: Mutex<Vec<i32>>,
}

impl RecordingSignals {
    fn sent(&self) -> Vec<i32> {
        self.sent
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

impl AgentProcessGroupSignalSender for RecordingSignals {
    fn send(&self, _process_group_id: i32, signal: i32) -> Result<(), String> {
        self.sent
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(signal);
        Ok(())
    }
}

struct SignallingReapChild {
    group: Option<Arc<AgentProcessGroup>>,
    reap_failures: usize,
}

impl AgentChild for SignallingReapChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(io::empty()))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(io::empty()))
    }

    fn observe_exit(&mut self) -> Result<bool, String> {
        Ok(true)
    }

    fn reap(&mut self) -> Result<i32, String> {
        if let Some(group) = self.group.as_ref() {
            let _ = group.signal(TERMINATE_PROCESS_GROUP_SIGNAL);
            let _ = group.force_stop();
        }
        if self.reap_failures > 0 {
            self.reap_failures -= 1;
            return Err("reap failure injected".to_string());
        }
        Ok(0)
    }

    fn process_group_id(&self) -> i32 {
        4242
    }

    fn force_kill(&mut self) -> Result<(), String> {
        Ok(())
    }
}

fn group_with_signalling_child(
    reap_failures: usize,
) -> (
    Arc<RecordingSignals>,
    Arc<AgentProcessGroup>,
    SignallingReapChild,
) {
    let signals = Arc::new(RecordingSignals::default());
    let group = AgentProcessGroup::new(
        4242,
        Arc::clone(&signals) as Arc<dyn AgentProcessGroupSignalSender>,
        Duration::ZERO,
    );
    let child = SignallingReapChild {
        group: Some(Arc::clone(&group)),
        reap_failures,
    };
    (signals, group, child)
}

#[test]
fn a_signal_racing_the_leader_reap_never_reaches_the_group() {
    let (signals, group, mut child) = group_with_signalling_child(0);
    assert_eq!(group.reap(&mut child), Ok(0));
    assert_eq!(signals.sent(), vec![KILL_PROCESS_GROUP_SIGNAL]);
    assert!(group.is_reaped());
    group.signal(TERMINATE_PROCESS_GROUP_SIGNAL).unwrap();
    assert_eq!(signals.sent(), vec![KILL_PROCESS_GROUP_SIGNAL]);
}

#[test]
fn a_failed_reap_keeps_the_unreaped_leader_signallable() {
    let (signals, group, mut child) = group_with_signalling_child(1);
    assert!(group.reap(&mut child).is_err());
    assert!(!group.is_reaped());
    child.group = None;
    group.force_stop().unwrap();
    assert_eq!(
        signals.sent(),
        vec![KILL_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert_eq!(group.reap(&mut child), Ok(0));
    assert!(group.is_reaped());
}
