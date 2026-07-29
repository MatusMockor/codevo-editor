use crate::*;

#[path = "language_features_facade.rs"]
mod language_features_facade;
#[path = "language_runtime_facade.rs"]
mod language_runtime_facade;
#[path = "workspace_facade.rs"]
mod workspace_facade;
#[path = "workspace_services.rs"]
mod workspace_services;

pub(crate) use language_features_facade::*;
pub(crate) use language_runtime_facade::*;
pub(crate) use workspace_facade::*;
pub(crate) use workspace_services::*;

#[path = "runtime.rs"]
mod runtime;

pub use runtime::run;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
