impl CdpClient {
    pub(crate) fn request_until(
        &self,
        method: &str,
        params: Value,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<Value, String> {
        ensure_watch_request_current(deadline, revoked)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let result = self.request_with_timeout(method, params, remaining.min(self.request_timeout));
        ensure_watch_request_current(deadline, revoked)?;
        result
    }

    fn request_until_with_reservation(
        &self,
        method: &str,
        params: Value,
        deadline: Instant,
        revoked: &AtomicBool,
        reserve: impl FnOnce(u64) -> Result<(), String>,
    ) -> Result<Value, String> {
        ensure_watch_request_current(deadline, revoked)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let result = self.request_with_reservation_timeout(
            method,
            params,
            remaining.min(self.request_timeout),
            reserve,
        );
        ensure_watch_request_current(deadline, revoked)?;
        result
    }

    pub(crate) fn shutdown_until(&mut self, deadline: Instant) {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        let Some(handle) = self.io_thread.take() else {
            return;
        };
        if handle.thread().id() == thread::current().id() {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if self.io_completed.recv_timeout(remaining).is_ok() {
            let _ = handle.join();
        }
    }
}

impl NodeCdpAdapter {
    #[cfg(test)]
    pub(crate) fn watch_smart_step_active_for_test(&self) -> bool {
        self.shared
            .lock()
            .map(|shared| shared.smart_step_policy.is_active())
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub(crate) fn watch_set_pause_for_test(&self, pause_generation: u64) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.pause_generation_epoch = pause_generation;
            shared.pause = Some(PauseInventory {
                pause_generation,
                ..PauseInventory::default()
            });
            shared.first_pause_seen = true;
        }
    }

    pub(crate) fn watch_current_pause_generation_until(
        &self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<Option<u64>, String> {
        let shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
        let epoch = shared.pause.as_ref().map(|pause| pause.pause_generation);
        drop(shared);
        ensure_watch_request_current(deadline, revoked)?;
        Ok(epoch)
    }

    pub(crate) fn watch_stack_trace_with_until<T>(
        &self,
        deadline: Instant,
        revoked: &AtomicBool,
        inspect: impl FnOnce(&[DebugStackFrame]) -> Result<T, String>,
    ) -> Result<T, String> {
        let shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        let result = inspect(&pause.frames)?;
        drop(shared);
        ensure_watch_request_current(deadline, revoked)?;
        Ok(result)
    }

    pub(crate) fn watch_scopes_with_until<T>(
        &self,
        frame_id: u64,
        deadline: Instant,
        revoked: &AtomicBool,
        inspect: impl FnOnce(&[DebugScopeInfo]) -> Result<T, String>,
    ) -> Result<T, String> {
        let shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        let scopes = pause
            .scopes
            .get(&frame_id)
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))?;
        let result = inspect(scopes)?;
        drop(shared);
        ensure_watch_request_current(deadline, revoked)?;
        Ok(result)
    }

    pub(crate) fn watch_run_if_waiting_for_debugger_until(
        &mut self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<(), String> {
        ensure_watch_request_current(deadline, revoked)?;
        self.client.request_until(
            "Runtime.runIfWaitingForDebugger",
            json!({}),
            deadline,
            revoked,
        )?;
        Ok(())
    }

    pub(crate) fn watch_pause_until(
        &mut self,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<(), String> {
        ensure_watch_request_current(deadline, revoked)?;
        let deferred_or_duplicate = {
            let mut shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
            shared.cancel_smart_step();
            mark_explicit_pause_requested(&mut shared)
        };
        if deferred_or_duplicate {
            return Ok(());
        }
        match self
            .client
            .request_until("Debugger.pause", json!({}), deadline, revoked)
        {
            Ok(_) => Ok(()),
            Err(error) => {
                if let Ok(mut shared) = self.shared.lock() {
                    shared.explicit_pause_requested = false;
                }
                Err(error)
            }
        }
    }

    pub(crate) fn watch_step_until(
        &mut self,
        kind: StepKind,
        deadline: Instant,
        revoked: &AtomicBool,
    ) -> Result<(), String> {
        ensure_watch_request_current(deadline, revoked)?;
        let direction = match kind {
            StepKind::StepOver => Some(smart_step::SmartStepDirection::Over),
            StepKind::StepInto => Some(smart_step::SmartStepDirection::Into),
            StepKind::StepOut => Some(smart_step::SmartStepDirection::Out),
            StepKind::Continue => None,
        };
        let origin_pause = {
            let mut shared = lock_watch_shared_until(&self.shared, deadline, revoked)?;
            if direction.is_some() {
                let Some(origin) = shared.pause.as_ref().map(|pause| pause.pause_generation) else {
                    shared.cancel_smart_step();
                    return Err("The debugger is not paused.".to_string());
                };
                Some(origin)
            } else {
                shared.cancel_smart_step();
                None
            }
        };
        let method = match kind {
            StepKind::Continue => "Debugger.resume",
            StepKind::StepOver => "Debugger.stepOver",
            StepKind::StepInto => "Debugger.stepInto",
            StepKind::StepOut => "Debugger.stepOut",
        };
        let outcome = match (direction, origin_pause) {
            (Some(direction), Some(origin_pause)) => {
                let shared = Arc::clone(&self.shared);
                self.client.request_until_with_reservation(
                    method,
                    json!({}),
                    deadline,
                    revoked,
                    move |request_id| {
                        let mut shared = shared.lock().map_err(|error| error.to_string())?;
                        let _ = shared.smart_step_policy.begin_user_step(
                            direction,
                            origin_pause,
                            request_id,
                            Instant::now(),
                        );
                        Ok(())
                    },
                )
            }
            _ => self
                .client
                .request_until(method, json!({}), deadline, revoked),
        };
        if outcome.is_err() {
            if let Ok(mut shared) = self.shared.lock() {
                shared.cancel_smart_step();
            }
        }
        outcome.map(|_| ())
    }

    pub(crate) fn watch_terminate_until(&mut self, deadline: Instant) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.pending_restart_frame = None;
            shared.cancel_smart_step();
            shared.invalidate_pause();
        }
        self.client.shutdown_until(deadline);
        if let DebuggeeOwnership::Spawned(process) =
            std::mem::replace(&mut self.ownership, DebuggeeOwnership::External)
        {
            process.terminate();
        }
    }
}

fn lock_watch_shared_until<'a>(
    shared: &'a Mutex<CdpShared>,
    deadline: Instant,
    revoked: &AtomicBool,
) -> Result<std::sync::MutexGuard<'a, CdpShared>, String> {
    loop {
        ensure_watch_request_current(deadline, revoked)?;
        match shared.try_lock() {
            Ok(shared) => return Ok(shared),
            Err(std::sync::TryLockError::WouldBlock) => thread::yield_now(),
            Err(std::sync::TryLockError::Poisoned(error)) => return Err(error.to_string()),
        }
    }
}

fn ensure_watch_request_current(deadline: Instant, revoked: &AtomicBool) -> Result<(), String> {
    if revoked.load(Ordering::Acquire) {
        return Err("The watch debug command was revoked.".to_string());
    }
    if Instant::now() >= deadline {
        return Err("The watch debug command timed out.".to_string());
    }
    Ok(())
}
