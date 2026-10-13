use crate::agent_task_spawner::agent_provider::process::ExecutableIdentity;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_ACCOUNTS: usize = 32;
const MAX_RECORDS: usize = 64;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct HistoryRecord {
    pub operation_id: String,
    pub used_at_epoch_ms: u64,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AccountHistory {
    records: Vec<HistoryRecord>,
    truncated: bool,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Persisted {
    accounts: BTreeMap<String, AccountHistory>,
    pending: BTreeMap<String, String>,
}
pub(super) struct Confirmation {
    pub window_label: String,
    pub generation: u64,
    pub identity: String,
    pub cli_identity: ExecutableIdentity,
    pub discovery_generation: u64,
    pub deadline: Instant,
}
pub(crate) struct LimitResetStore {
    path: PathBuf,
    confirmations: Mutex<BTreeMap<String, Confirmation>>,
    history: Mutex<()>,
}
impl LimitResetStore {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            path: directory.join("codex-limit-reset-history.json"),
            confirmations: Mutex::new(BTreeMap::new()),
            history: Mutex::new(()),
        }
    }
    pub(super) fn prepare(&self, mut confirmation: Confirmation) -> Result<String, String> {
        let token = random_token()?;
        let mut confirmations = self
            .confirmations
            .lock()
            .map_err(|_| "Reset confirmations were unavailable.")?;
        confirmations.retain(|_, value| value.deadline > Instant::now());
        if confirmations.len() >= 8 {
            return Err("Too many reset confirmations are pending.".into());
        }
        confirmation.deadline = Instant::now() + Duration::from_secs(60);
        confirmations.insert(token.clone(), confirmation);
        Ok(token)
    }
    pub(super) fn take(&self, token: &str, generation: u64) -> Result<Confirmation, String> {
        let confirmation = self
            .confirmations
            .lock()
            .map_err(|_| "Reset confirmations were unavailable.")?
            .remove(token)
            .ok_or("Reset confirmation expired or was already used.")?;
        if confirmation.generation != generation || confirmation.deadline <= Instant::now() {
            return Err("Reset confirmation expired or belongs to a different provider.".into());
        }
        Ok(confirmation)
    }
    fn load(&self) -> Result<Persisted, String> {
        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Persisted::default())
            }
            Err(_) => return Err("Reset history could not be read.".into()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Reset history could not be read.")?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("Reset history exceeded its limit.".into());
        }
        let data: Persisted =
            serde_json::from_slice(&bytes).map_err(|_| "Reset history was invalid.")?;
        if data.accounts.len() > MAX_ACCOUNTS
            || data.pending.len() > 64
            || data.accounts.iter().any(|(id, h)| {
                !account_id(id)
                    || h.records.len() > MAX_RECORDS
                    || h.records.iter().any(|r| {
                        !operation_key(&r.operation_id)
                            || r.used_at_epoch_ms > 8_640_000_000_000_000
                    })
            })
            || data
                .pending
                .iter()
                .any(|(key, id)| !operation_key(key) || !account_id(id))
        {
            return Err("Reset history was invalid or excessive.".into());
        }
        Ok(data)
    }
    fn save(&self, data: &Persisted) -> Result<(), String> {
        let bytes = serde_json::to_vec(data).map_err(|_| "Reset history could not be encoded.")?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("Reset history exceeded its limit.".into());
        }
        let parent = self
            .path
            .parent()
            .ok_or("Reset history path was invalid.")?;
        fs::create_dir_all(parent).map_err(|_| "Reset history directory could not be created.")?;
        let temp = parent.join(format!(".codex-reset-{}.tmp", random_token()?));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temp)
                .map_err(|_| "Reset history could not be saved.")?;
            file.write_all(&bytes)
                .and_then(|()| file.sync_all())
                .map_err(|_| "Reset history could not be saved.")?;
            fs::rename(&temp, &self.path).map_err(|_| "Reset history could not be saved.")?;
            #[cfg(unix)]
            fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| "Reset history could not be committed.")?;
            Ok(())
        })();
        let _ = fs::remove_file(temp);
        result
    }
    pub(super) fn history(
        &self,
        identity: Option<&str>,
    ) -> Result<(Vec<HistoryRecord>, bool, Option<String>), String> {
        let Some(identity) = identity else {
            return Ok((Vec::new(), false, None));
        };
        let _guard = self
            .history
            .lock()
            .map_err(|_| "Reset history was unavailable.")?;
        let data = self.load()?;
        let pending = data
            .pending
            .iter()
            .find(|(_, id)| id.as_str() == identity)
            .map(|(key, _)| key.clone());
        let Some(history) = data.accounts.get(identity) else {
            return Ok((Vec::new(), false, pending));
        };
        Ok((
            history.records.iter().rev().cloned().collect(),
            history.truncated,
            pending,
        ))
    }
    pub(super) fn begin(&self, identity: &str, key: &str) -> Result<(), String> {
        if !account_id(identity) || !operation_key(key) {
            return Err("Reset operation identity was invalid.".into());
        }
        let _guard = self
            .history
            .lock()
            .map_err(|_| "Reset history was unavailable.")?;
        let mut data = self.load()?;
        if data
            .pending
            .iter()
            .any(|(pending_key, account)| account == identity && pending_key != key)
        {
            return Err("A previous reset has an uncertain outcome. Retry that operation before using another reset.".into());
        }
        if data
            .pending
            .get(key)
            .is_some_and(|account| account != identity)
            || data.accounts.iter().any(|(account, h)| {
                account != identity && h.records.iter().any(|r| r.operation_id == key)
            })
        {
            return Err("Reset operation belongs to a different account.".into());
        }
        let identities: BTreeSet<_> = data.accounts.keys().chain(data.pending.values()).collect();
        if !identities.contains(&identity.to_string()) && identities.len() >= MAX_ACCOUNTS {
            return Err("Reset account history reached its limit.".into());
        }
        if !data.pending.contains_key(key) && data.pending.len() >= 64 {
            return Err("Too many reset operations have uncertain outcomes.".into());
        }
        data.pending.insert(key.to_string(), identity.to_string());
        self.save(&data)
    }
    pub(super) fn finish(
        &self,
        identity: &str,
        key: &str,
        outcome: &str,
        timestamp: u64,
    ) -> Result<(), String> {
        let _guard = self
            .history
            .lock()
            .map_err(|_| "Reset history was unavailable.")?;
        let mut data = self.load()?;
        if data.pending.get(key).map(String::as_str) != Some(identity) {
            return Err("Reset operation history authority changed.".into());
        }
        data.pending.remove(key);
        if matches!(outcome, "reset" | "alreadyRedeemed") {
            let h = data.accounts.entry(identity.to_string()).or_default();
            if !h.records.iter().any(|r| r.operation_id == key) {
                if h.records.len() == MAX_RECORDS {
                    h.records.remove(0);
                    h.truncated = true;
                }
                h.records.push(HistoryRecord {
                    operation_id: key.to_string(),
                    used_at_epoch_ms: timestamp,
                });
            }
        }
        self.save(&data)
    }
}
pub(super) fn operation_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
pub(super) fn account_id(value: &str) -> bool {
    value
        .strip_prefix("account:v1:sha256:")
        .is_some_and(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| "Reset confirmation entropy was unavailable.")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    fn confirmation() -> Confirmation {
        Confirmation {
            window_label: "main".into(),
            generation: 1,
            identity: account('a'),
            cli_identity: crate::agent_task_spawner::agent_provider::process::executable_identity(
                "/bin/sh",
            )
            .unwrap(),
            discovery_generation: 1,
            deadline: Instant::now(),
        }
    }
    #[cfg(unix)]
    #[test]
    fn confirmations_are_bounded_expiring_and_single_use_for_one_generation() {
        let store = store();
        let token = store.prepare(confirmation()).unwrap();
        assert_eq!(token.len(), 64);
        assert!(store.take(&token, 1).is_ok());
        assert!(store.take(&token, 1).is_err());
        let token = store.prepare(confirmation()).unwrap();
        assert!(store.take(&token, 2).is_err());
        assert!(store.take(&token, 1).is_err());
        let token = store.prepare(confirmation()).unwrap();
        store
            .confirmations
            .lock()
            .unwrap()
            .get_mut(&token)
            .unwrap()
            .deadline = Instant::now();
        assert!(store.take(&token, 1).is_err());
        for _ in 0..8 {
            store.prepare(confirmation()).unwrap();
        }
        assert!(store.prepare(confirmation()).is_err());
    }
    fn account(suffix: char) -> String {
        format!("account:v1:sha256:{}", suffix.to_string().repeat(64))
    }
    fn store() -> LimitResetStore {
        LimitResetStore::new(std::env::temp_dir().join(format!(
            "codevo-reset-store-test-{}",
            random_token().unwrap()
        )))
    }
    #[test]
    fn uncertainty_survives_restart_and_refuses_new_or_foreign_keys() {
        let store = store();
        let first = account('a');
        let second = account('b');
        store.begin(&first, "key-1").unwrap();
        let restarted = LimitResetStore::new(store.path.parent().unwrap().to_path_buf());
        assert_eq!(
            restarted.history(Some(&first)).unwrap().2.as_deref(),
            Some("key-1")
        );
        assert!(restarted.begin(&first, "key-2").is_err());
        assert!(restarted.begin(&second, "key-1").is_err());
        restarted.begin(&first, "key-1").unwrap();
        restarted.finish(&first, "key-1", "reset", 123).unwrap();
        restarted.begin(&first, "key-1").unwrap();
        restarted
            .finish(&first, "key-1", "alreadyRedeemed", 456)
            .unwrap();
        let history = restarted.history(Some(&first)).unwrap();
        assert_eq!(history.0.len(), 1);
        assert_eq!(history.0[0].used_at_epoch_ms, 123);
        assert!(history.2.is_none());
        assert!(restarted.begin(&second, "key-1").is_err());
        assert!(restarted.history(Some(&second)).unwrap().0.is_empty());
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn history_is_bounded_and_reports_eviction_and_no_credit_is_not_recorded() {
        let store = store();
        let account = account('a');
        for index in 0..65 {
            let key = format!("key-{index}");
            store.begin(&account, &key).unwrap();
            store.finish(&account, &key, "reset", index).unwrap();
        }
        store.begin(&account, "no-credit").unwrap();
        store.finish(&account, "no-credit", "noCredit", 99).unwrap();
        let (records, truncated, pending) = store.history(Some(&account)).unwrap();
        assert_eq!(records.len(), 64);
        assert!(truncated);
        assert!(pending.is_none());
        assert_eq!(records[0].used_at_epoch_ms, 64);
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn rejects_excessive_corrupt_history_and_invalid_operation_keys() {
        let store = store();
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        fs::write(&store.path, vec![b'x'; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert!(store.history(Some(&account('a'))).is_err());
        assert!(store.begin(&account('a'), "bad key").is_err());
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
}
