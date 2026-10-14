use super::{interactions::InteractionRunnerPort, interactions_ledger::InteractionLedger};
use serde_json::Value;
use std::{
    cell::Cell,
    time::{Duration, Instant},
};

pub(super) const MAX_PAGE_CALLS: usize = 8;
pub(super) const PAGE_BUDGET: Duration = Duration::from_secs(2);
const PAGE_SPENT: &str = "Runner page budget is spent.";

pub(super) struct PageBudget<'a, P> {
    port: &'a P,
    clock: &'a dyn Fn() -> Instant,
    deadline: Instant,
    ceiling: Instant,
    calls: Cell<usize>,
    bounded: Cell<bool>,
    refused: Cell<bool>,
}

impl<'a, P: InteractionRunnerPort> PageBudget<'a, P> {
    pub(super) fn new(port: &'a P, clock: &'a dyn Fn() -> Instant, ceiling: Instant) -> Self {
        Self {
            port,
            clock,
            deadline: clock() + PAGE_BUDGET,
            ceiling,
            calls: Cell::new(0),
            bounded: Cell::new(false),
            refused: Cell::new(false),
        }
    }

    pub(super) fn bind(&self, progressed: bool) {
        self.bounded.set(progressed);
    }

    pub(super) fn is_spent(&self) -> bool {
        self.calls.get() >= MAX_PAGE_CALLS
            || (self.bounded.get() && self.now() >= self.deadline)
            || self.is_overdue()
    }

    pub(super) fn ran_out(&self) -> bool {
        self.refused.get() || (self.bounded.get() && self.now() >= self.deadline)
    }

    pub(super) fn is_overdue(&self) -> bool {
        self.now() >= self.ceiling
    }

    fn call_deadline(&self) -> Instant {
        if !self.bounded.get() {
            return self.ceiling;
        }
        self.deadline.min(self.ceiling)
    }
}

impl<P: InteractionRunnerPort> InteractionRunnerPort for PageBudget<'_, P> {
    fn runner_id(&self) -> &str {
        self.port.runner_id()
    }

    fn is_current(&self) -> bool {
        self.port.is_current()
    }

    fn ledger(&self) -> &InteractionLedger {
        self.port.ledger()
    }

    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String> {
        self.call_before(method, path, body, None)
    }

    fn call_before(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
        _deadline: Option<Instant>,
    ) -> Result<Value, String> {
        if self.is_spent() {
            self.refused.set(true);
            return Err(PAGE_SPENT.into());
        }
        self.calls.set(self.calls.get() + 1);
        self.port
            .call_before(method, path, body, Some(self.call_deadline()))
    }

    fn now(&self) -> Instant {
        (self.clock)()
    }
}
