use super::{types, InventoryChangeEvent};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Invalidation {
    Snapshot {
        #[serde(rename = "runnerId")]
        runner_id: String,
        epoch: String,
        revision: u64,
    },
    Changed {
        #[serde(rename = "runnerId")]
        runner_id: String,
        epoch: String,
        revision: u64,
    },
}

#[derive(Default)]
pub(super) struct Cursor(pub(super) Option<(String, u64)>);
impl Cursor {
    pub(super) fn accept(
        &mut self,
        text: &str,
        expected_runner: &str,
    ) -> Result<Option<InventoryChangeEvent>, ()> {
        if text.len() > 4096 {
            return Err(());
        }
        let message: Invalidation = serde_json::from_str(text).map_err(|_| ())?;
        let (snapshot, runner, epoch, revision) = match message {
            Invalidation::Snapshot {
                runner_id,
                epoch,
                revision,
            } => (true, runner_id, epoch, revision),
            Invalidation::Changed {
                runner_id,
                epoch,
                revision,
            } => (false, runner_id, epoch, revision),
        };
        if runner != expected_runner
            || types::uuid(&epoch).is_err()
            || revision > 9_007_199_254_740_991
        {
            return Err(());
        }
        match &self.0 {
            None if snapshot => {
                self.0 = Some((epoch, revision));
                Ok(Some(InventoryChangeEvent::Connected))
            }
            Some((previous_epoch, previous_revision)) if !snapshot && previous_epoch == &epoch => {
                if revision <= *previous_revision {
                    return Ok(None);
                }
                self.0 = Some((epoch, revision));
                Ok(Some(InventoryChangeEvent::Changed))
            }
            _ => Err(()),
        }
    }
}
