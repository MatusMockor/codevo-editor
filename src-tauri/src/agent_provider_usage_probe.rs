use serde_json::Value;
use std::{
    io::Write,
    process::ChildStdin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

pub(super) const INITIAL_REQUEST: &str = "{\"method\":\"initialize\",\"id\":0,\"params\":{\"clientInfo\":{\"name\":\"codevo_editor\",\"title\":\"Codevo Editor\",\"version\":\"0.2.0\"}}}\n";
const REQUESTS: [&str; 3] = [
    "{\"method\":\"initialized\",\"params\":{}}\n{\"method\":\"account/read\",\"id\":2,\"params\":{\"refreshToken\":false}}\n",
    "{\"method\":\"account/rateLimits/read\",\"id\":1}\n",
    "{\"method\":\"account/read\",\"id\":3,\"params\":{\"refreshToken\":false}}\n",
];
const RESPONSE_IDS: [u64; 4] = [0, 2, 1, 3];

#[derive(Clone, Debug, Default)]
pub(super) struct CodexUsageProbe(Arc<AtomicUsize>);

impl CodexUsageProbe {
    pub(super) fn advance_input(&self, stdin: Option<&mut ChildStdin>) -> Result<bool, String> {
        let acknowledged = self.0.load(Ordering::Acquire);
        if acknowledged == RESPONSE_IDS.len() * 2 - 1 {
            return Ok(true);
        }
        if acknowledged % 2 == 1 {
            let request = REQUESTS
                .get(acknowledged / 2)
                .ok_or("Provider usage protocol was invalid.")?;
            self.0.store(acknowledged + 1, Ordering::Release);
            stdin
                .ok_or("Provider input pipe was unavailable.")?
                .write_all(request.as_bytes())
                .map_err(|_| "Provider input pipe could not be written.".to_string())?;
        }
        Ok(false)
    }

    pub(super) fn is_complete(&self) -> bool {
        self.0.load(Ordering::Acquire) == RESPONSE_IDS.len() * 2 - 1
    }

    pub(super) fn reader(&self) -> CodexUsageProbeReader {
        CodexUsageProbeReader {
            probe: self.clone(),
            pending: Vec::new(),
        }
    }
}

pub(super) struct CodexUsageProbeReader {
    probe: CodexUsageProbe,
    pending: Vec<u8>,
}
impl CodexUsageProbeReader {
    pub(super) fn observe(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if *byte != b'\n' {
                self.pending.push(*byte);
                continue;
            }
            let stage = self.probe.0.load(Ordering::Acquire);
            if let (Some(id), Ok(value)) = (
                RESPONSE_IDS
                    .get(stage / 2)
                    .filter(|_| stage.is_multiple_of(2)),
                super::parse_provider_probe_json(&self.pending).ok_or(()),
            ) {
                if value.get("id").and_then(Value::as_u64) == Some(*id)
                    && (value.get("result").is_some()
                        || (stage > 0 && value.get("error").is_some()))
                    && (stage > 0 || value.get("error").is_none())
                {
                    let _ = self.probe.0.compare_exchange(
                        stage,
                        stage + 1,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    );
                }
            }
            self.pending.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initialization_failure_does_not_authorize_account_requests() {
        let probe = CodexUsageProbe::default();
        probe
            .reader()
            .observe(b"{\"id\":0,\"error\":{\"message\":\"unsupported\"}}\n");
        assert_eq!(probe.0.load(Ordering::Acquire), 0);
        assert!(!probe.is_complete());
    }
    #[test]
    fn accepts_only_ordered_complete_json_responses() {
        let probe = CodexUsageProbe::default();
        let mut reader = probe.reader();
        reader.observe(b"{\"id\":3,\"result\":{}}\n{\"id\":0,\"result\":{");
        assert_eq!(probe.0.load(Ordering::Acquire), 0);
        reader.observe(b"}}\n");
        assert_eq!(probe.0.load(Ordering::Acquire), 1);
        reader.observe(b"{\"id\":2,\"result\":{}}\n");
        assert_eq!(probe.0.load(Ordering::Acquire), 1);
        probe.0.store(2, Ordering::Release);
        reader.observe(b"{ \"id\": 2, \"result\": {} }\n");
        assert_eq!(probe.0.load(Ordering::Acquire), 3);
        probe.0.store(4, Ordering::Release);
        reader.observe(b"{\"id\":1,\"error\":{}}\n");
        assert_eq!(probe.0.load(Ordering::Acquire), 5);
        probe.0.store(6, Ordering::Release);
        reader.observe(b"{\"id\":3,\"result\":{}}\n");
        assert_eq!(probe.0.load(Ordering::Acquire), 7);
    }
}
