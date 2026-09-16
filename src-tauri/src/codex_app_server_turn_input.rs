use super::*;
pub struct CodexTurnInput {
    pub(super) state: Arc<TurnState>,
}

impl CodexTurnInput {
    pub fn steer(
        &mut self,
        input: Vec<UserInput>,
        client_user_message_id: Option<String>,
        deadline: Instant,
    ) -> io::Result<()> {
        if self.state.input_closed.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::ErrorKind::TimedOut.into());
        }
        let params = TurnSteerParams {
            thread_id: self.state.thread_id.clone(),
            expected_turn_id: self.state.turn_id.clone(),
            input,
            client_user_message_id,
        };
        let turn = self
            .state
            .port
            .steer(params, remaining)
            .map_err(|failure| match failure {
                CodexRpcFailure::Timeout => io::Error::from(io::ErrorKind::TimedOut),
                CodexRpcFailure::Rpc(ref error)
                    if classify_error(error) == CodexRpcErrorKind::ActiveTurnNotSteerable =>
                {
                    io::Error::new(
                        io::ErrorKind::WouldBlock,
                        "Codex turn is not currently steerable.",
                    )
                }
                _ => io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "Codex could not accept the steering message.",
                ),
            })?;
        if turn != self.state.turn_id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Codex returned a different turn.",
            ));
        }
        Ok(())
    }

    pub fn close(&mut self) {
        self.state.input_closed.store(true, Ordering::SeqCst);
    }
    pub fn cancellation_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.state.input_closed)
    }
}

impl crate::agent_task_spawner::agent_task_input::AgentTaskInput for CodexTurnInput {
    fn kind(&self) -> crate::agent_task_spawner::agent_task_input::AgentTaskInputKind {
        crate::agent_task_spawner::agent_task_input::AgentTaskInputKind::CodexInput
    }
    fn write_frame(&mut self, _frame: &[u8], _deadline: Instant) -> io::Result<()> {
        Err(io::ErrorKind::InvalidInput.into())
    }
    fn write_input(
        &mut self,
        frame: &crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame,
        deadline: Instant,
    ) -> io::Result<()> {
        match frame {
            crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame::CodexInput {
                input,
                client_user_message_id,
            } => self.steer(input.clone(), client_user_message_id.clone(), deadline),
            _ => Err(io::ErrorKind::InvalidInput.into()),
        }
    }
    fn close(&mut self) {
        CodexTurnInput::close(self);
    }
    fn cancellation_flag(&self) -> Option<Arc<AtomicBool>> {
        Some(CodexTurnInput::cancellation_flag(self))
    }
}
