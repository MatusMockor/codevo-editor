use super::*;

const MAINTENANCE_WORK_BURST: Duration = Duration::from_millis(1);
const MAINTENANCE_YIELD: Duration = Duration::from_millis(3);
const CANCELLATION_POLL: Duration = Duration::from_millis(1);
const MAX_MAINTENANCE_WAIT: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
pub(super) enum ExecutableValidationEffort {
    Interactive,
    Maintenance,
}

pub(super) trait DigestClock {
    fn elapsed(&self) -> Duration;
    fn wait(&self, duration: Duration);
}

pub(super) struct SystemDigestClock(Instant);

impl DigestClock for SystemDigestClock {
    fn elapsed(&self) -> Duration {
        self.0.elapsed()
    }

    fn wait(&self, duration: Duration) {
        thread::sleep(duration);
    }
}

pub(super) struct ExecutableDigestBudget<C = SystemDigestClock> {
    effort: ExecutableValidationEffort,
    clock: C,
    burst_started: Duration,
    waited: Duration,
}

impl ExecutableDigestBudget {
    pub(super) fn new(effort: ExecutableValidationEffort) -> Self {
        Self::with_clock(effort, SystemDigestClock(Instant::now()))
    }
}

impl<C: DigestClock> ExecutableDigestBudget<C> {
    fn with_clock(effort: ExecutableValidationEffort, clock: C) -> Self {
        let burst_started = clock.elapsed();
        Self {
            effort,
            clock,
            burst_started,
            waited: Duration::ZERO,
        }
    }

    fn checkpoint(&mut self, cancelled: &impl Fn() -> bool) -> Result<(), String> {
        if cancelled() {
            return Err("Provider executable validation was cancelled.".to_string());
        }
        match self.effort {
            ExecutableValidationEffort::Interactive => return Ok(()),
            ExecutableValidationEffort::Maintenance => {}
        }
        if self.waited >= MAX_MAINTENANCE_WAIT
            || self.clock.elapsed().saturating_sub(self.burst_started) < MAINTENANCE_WORK_BURST
        {
            return Ok(());
        }
        let mut remaining = MAINTENANCE_YIELD.min(MAX_MAINTENANCE_WAIT - self.waited);
        while !remaining.is_zero() {
            if cancelled() {
                return Err("Provider executable validation was cancelled.".to_string());
            }
            let step = CANCELLATION_POLL.min(remaining);
            self.clock.wait(step);
            self.waited += step;
            remaining -= step;
            if cancelled() {
                return Err("Provider executable validation was cancelled.".to_string());
            }
        }
        self.burst_started = self.clock.elapsed();
        Ok(())
    }
}

pub(super) fn digest_with_budget<C: DigestClock>(
    descriptor: &fs::File,
    size: u64,
    cancelled: impl Fn() -> bool,
    budget: &mut ExecutableDigestBudget<C>,
) -> Result<[u8; 32], String> {
    #[cfg(test)]
    DIGEST_WORK.with(|work| {
        let (calls, bytes) = work.get();
        work.set((calls + 1, bytes));
    });
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let limit = size.saturating_add(1);
    let mut offset = 0_u64;
    while offset < limit {
        budget.checkpoint(&cancelled)?;
        let remaining = usize::try_from((limit - offset).min(buffer.len() as u64))
            .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
        let count = read_executable_at(descriptor, &mut buffer[..remaining], offset)
            .map_err(|_| "Provider executable identity is unavailable.".to_string())?;
        if count == 0 {
            break;
        }
        #[cfg(test)]
        DIGEST_WORK.with(|work| {
            let (calls, bytes) = work.get();
            work.set((calls, bytes + count as u64));
        });
        hasher.update(&buffer[..count]);
        offset = offset.saturating_add(count as u64);
    }
    Ok(hasher.finalize().into())
}

#[cfg(test)]
#[path = "agent_provider_digest_budget_tests.rs"]
mod tests;
