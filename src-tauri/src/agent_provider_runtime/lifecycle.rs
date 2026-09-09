use super::*;

impl AgentProviderRuntimeRegistry {
    pub fn close_operation_admission(&self) {
        let mut state = self.state();
        state.starts_closed = true;
        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let claude_generation = state.next_generation;
        if let Some(configuration) = state.claude_code.as_mut() {
            configuration.generation = claude_generation;
            configuration.candidate = None;
        }
        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let codex_generation = state.next_generation;
        if let Some(configuration) = state.codex.as_mut() {
            configuration.generation = codex_generation;
            configuration.candidate = None;
        }
    }

    pub fn operations_closed(&self) -> bool {
        self.state().starts_closed
    }

    pub fn shutdown_operations(&self, timeout: Duration) -> bool {
        self.close_operation_admission();
        let deadline = Instant::now() + timeout;
        let mut state = self.state();
        while state.health_count > 0
            || state.update_check_count > 0
            || state.update_active
            || sign_in_active(&state)
        {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline.saturating_duration_since(now);
            let Ok((next, result)) = self.settlement.wait_timeout(state, remaining) else {
                return false;
            };
            state = next;
            if result.timed_out()
                && (state.health_count > 0
                    || state.update_check_count > 0
                    || state.update_active
                    || sign_in_active(&state))
            {
                return false;
            }
        }
        true
    }
}
