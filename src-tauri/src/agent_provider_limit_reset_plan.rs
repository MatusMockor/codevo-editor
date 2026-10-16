use super::{
    validate_effective_path, AgentProviderProcessPlan, ExecutableIdentity, InteractiveProbe,
};
use crate::agent_task_spawner::agent_provider::process::parse_provider_probe_json;
use serde_json::{json, Value};
use std::{
    fmt,
    io::Write,
    process::ChildStdin,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const MAX_STREAM: usize = 256 * 1024;
const INITIAL: &str = "{\"method\":\"initialize\",\"id\":0,\"params\":{\"clientInfo\":{\"name\":\"codevo_editor\",\"title\":\"Codevo\",\"version\":\"0.2.0\"},\"capabilities\":{\"experimentalApi\":true}}}\n";
type Authority = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;
type Consume = (String, String, Option<String>);

#[derive(Debug, Default)]
struct Protocol {
    stage: usize,
    ready: bool,
    pending: Vec<u8>,
    transcript: Vec<u8>,
    outcome: Option<String>,
    error: Option<String>,
}

pub struct LimitResetProbe {
    protocol: Mutex<Protocol>,
    consume: Option<Consume>,
    identity: fn(&[u8]) -> Option<String>,
    authority: Authority,
}
impl fmt::Debug for LimitResetProbe {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LimitResetProbe")
    }
}
impl LimitResetProbe {
    pub fn new(
        consume: Option<Consume>,
        identity: fn(&[u8]) -> Option<String>,
        authority: Authority,
    ) -> Arc<Self> {
        Arc::new(Self {
            protocol: Mutex::new(Protocol::default()),
            consume,
            identity,
            authority,
        })
    }
    pub fn snapshot(&self) -> Result<(Vec<u8>, Option<String>), String> {
        let p = self
            .protocol
            .lock()
            .map_err(|_| "Reset probe was unavailable.")?;
        if let Some(error) = &p.error {
            return Err(error.clone());
        }
        if !self.done(&p) {
            return Err("Reset probe did not complete.".into());
        }
        Ok((p.transcript.clone(), p.outcome.clone()))
    }
    fn done(&self, p: &Protocol) -> bool {
        p.stage == if self.consume.is_some() { 5 } else { 4 }
    }
    fn next(&self) -> Result<Option<Vec<u8>>, String> {
        let mut p = self
            .protocol
            .lock()
            .map_err(|_| "Reset probe was unavailable.")?;
        if let Some(error) = &p.error {
            return Err(error.clone());
        }
        if self.done(&p) || !p.ready {
            return Ok(None);
        }
        let request = match p.stage {
            1 => json!({"id":2,"method":"account/read","params":{"refreshToken":false}}),
            2 => json!({"id":1,"method":"account/rateLimits/read"}),
            3 => json!({"id":3,"method":"account/read","params":{"refreshToken":false}}),
            4 => {
                let (expected, key, credit_id) =
                    self.consume.as_ref().ok_or("Reset protocol was invalid.")?;
                if (self.identity)(&p.transcript).as_ref() != Some(expected) {
                    return Err(
                        "Codex account changed before reset. Refresh usage and try again.".into(),
                    );
                }
                let mut params = json!({"idempotencyKey":key});
                if let Some(credit_id) = credit_id {
                    params["creditId"] = json!(credit_id);
                }
                json!({"id":4,"method":"account/rateLimitResetCredit/consume","params":params})
            }
            _ => return Err("Reset protocol was invalid.".into()),
        };
        p.ready = false;
        let initialized = if p.stage == 1 {
            "{\"method\":\"initialized\",\"params\":{}}\n"
        } else {
            ""
        };
        Ok(Some(format!("{initialized}{request}\n").into_bytes()))
    }
}
impl InteractiveProbe for LimitResetProbe {
    fn observe(&self, bytes: &[u8]) {
        let Ok(mut p) = self.protocol.lock() else {
            return;
        };
        for byte in bytes {
            if p.error.is_some() || self.done(&p) {
                return;
            }
            if p.pending.len() + p.transcript.len() >= MAX_STREAM {
                p.error = Some("Reset response exceeded its limit.".into());
                return;
            }
            if *byte != b'\n' {
                p.pending.push(*byte);
                continue;
            }
            let ids = [0, 2, 1, 3, 4];
            if let Some(value) = parse_provider_probe_json(&p.pending) {
                if !p.ready && value.get("id").and_then(Value::as_u64) == ids.get(p.stage).copied()
                {
                    if value.get("error").is_some() || value.get("result").is_none() {
                        p.error =
                            Some("Codex reset API is unavailable or rejected the request.".into());
                    } else {
                        if p.stage == 4 {
                            let outcome = value["result"]["outcome"].as_str();
                            if !matches!(
                                outcome,
                                Some("reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit")
                            ) {
                                p.error = Some("Codex returned an unknown reset outcome.".into());
                            } else {
                                p.outcome = outcome.map(str::to_string);
                            }
                        }
                        let line = std::mem::take(&mut p.pending);
                        p.transcript.extend_from_slice(&line);
                        p.transcript.push(b'\n');
                        p.stage += 1;
                        p.ready = true;
                    }
                }
            }
            p.pending.clear();
        }
    }
    fn advance(&self, stdin: Option<&mut ChildStdin>, _now: Instant) -> Result<bool, String> {
        let Some(request) = self.next()? else {
            return Ok(self.is_complete());
        };
        // Exact authority must still hold immediately before the irreversible write.
        (self.authority)()?;
        stdin
            .ok_or("Provider input pipe was unavailable.")?
            .write_all(&request)
            .map_err(|_| "Provider input pipe could not be written.".to_string())?;
        Ok(false)
    }
    fn is_complete(&self) -> bool {
        self.protocol
            .lock()
            .is_ok_and(|p| self.done(&p) && p.error.is_none())
    }
}
impl AgentProviderProcessPlan {
    pub fn limit_reset_with_effective_path(
        identity: ExecutableIdentity,
        effective_path: &str,
        probe: Arc<LimitResetProbe>,
    ) -> Result<Self, String> {
        let mut plan = Self::new(
            identity,
            vec!["app-server", "--stdio"],
            validate_effective_path(effective_path)?,
            Duration::from_secs(15),
            MAX_STREAM,
            false,
        );
        plan.stdin_payload = Some(INITIAL.as_bytes().into());
        plan.interactive_probe = Some(probe);
        Ok(plan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity(_: &[u8]) -> Option<String> {
        Some("account".into())
    }
    fn observe(p: &LimitResetProbe, id: u64, result: Value) {
        p.observe(format!("{}\n", json!({"id":id,"result":result})).as_bytes());
    }
    fn through_account(p: &LimitResetProbe) {
        for id in [0, 2, 1, 3] {
            observe(p, id, json!({}));
            if id != 3 {
                assert!(p.next().unwrap().is_some());
            }
        }
    }
    #[test]
    fn read_never_emits_consume() {
        let p = LimitResetProbe::new(None, identity, Arc::new(|| Ok(())));
        through_account(&p);
        assert!(p.is_complete());
        assert!(p.next().unwrap().is_none());
    }
    #[test]
    fn rejects_switched_account_before_consume_and_unknown_outcome() {
        let p = LimitResetProbe::new(
            Some(("foreign".into(), "key".into(), None)),
            identity,
            Arc::new(|| Ok(())),
        );
        through_account(&p);
        assert!(p.next().is_err());
        let p = LimitResetProbe::new(
            Some(("account".into(), "key".into(), None)),
            identity,
            Arc::new(|| Ok(())),
        );
        through_account(&p);
        let request = String::from_utf8(p.next().unwrap().unwrap()).unwrap();
        assert!(request.contains("account/rateLimitResetCredit/consume"));
        assert_eq!(
            serde_json::from_str::<Value>(request.trim()).unwrap()["params"],
            json!({"idempotencyKey":"key"})
        );
        observe(&p, 4, json!({"outcome":"future"}));
        assert!(p.snapshot().is_err());
    }
    #[test]
    fn ignores_foreign_reordered_responses_and_rejects_excessive_output() {
        let p = LimitResetProbe::new(None, identity, Arc::new(|| Ok(())));
        observe(&p, 3, json!({}));
        assert!(p.next().unwrap().is_none());
        p.observe(&vec![b'x'; MAX_STREAM + 1]);
        assert!(p.snapshot().is_err());
    }
    #[test]
    fn consume_targets_the_chosen_credit_only_when_one_was_selected() {
        let p = LimitResetProbe::new(
            Some(("account".into(), "key".into(), Some("credit-1".into()))),
            identity,
            Arc::new(|| Ok(())),
        );
        through_account(&p);
        let request = String::from_utf8(p.next().unwrap().unwrap()).unwrap();
        let request: Value = serde_json::from_str(request.trim()).unwrap();
        assert_eq!(request["method"], "account/rateLimitResetCredit/consume");
        assert_eq!(
            request["params"],
            json!({"idempotencyKey":"key","creditId":"credit-1"})
        );
        observe(&p, 4, json!({"outcome":"reset"}));
        assert_eq!(p.snapshot().unwrap().1.as_deref(), Some("reset"));
    }
}
