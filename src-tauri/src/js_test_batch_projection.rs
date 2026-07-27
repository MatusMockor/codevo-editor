use super::{
    parse_jest_json_with_limits, JsTestBatchPackageResult, MAX_CASES, MAX_REPORT_BYTES, MAX_SUITES,
};
use crate::php_test_run::PhpTestRunResponse;
use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

#[derive(Default)]
pub(super) struct BatchProjectionBudgetState {
    pub(super) cases: usize,
    report_bytes: u64,
    pub(super) suites: usize,
}

#[derive(Default)]
pub(super) struct BatchProjectionBudget {
    pub(super) state: Mutex<BatchProjectionBudgetState>,
}

impl BatchProjectionBudget {
    pub(super) fn reserve_report_bytes(&self, bytes: u64) -> Result<(), String> {
        let mut state = self.state();
        let report_bytes = state
            .report_bytes
            .checked_add(bytes)
            .ok_or_else(|| "JavaScript test batch report budget overflowed.".to_string())?;
        if report_bytes > MAX_REPORT_BYTES {
            return Err(format!(
                "JavaScript test batch reports exceed the aggregate {MAX_REPORT_BYTES} byte safety limit."
            ));
        }
        state.report_bytes = report_bytes;
        Ok(())
    }

    pub(super) fn release_report_bytes(&self, bytes: u64) {
        let mut state = self.state();
        state.report_bytes = state.report_bytes.saturating_sub(bytes);
    }

    pub(super) fn parse_and_reserve(
        &self,
        json: &[u8],
        root: &Path,
    ) -> Result<PhpTestRunResponse, String> {
        let mut state = self.state();
        let response = parse_jest_json_with_limits(
            json,
            root,
            MAX_SUITES.saturating_sub(state.suites),
            MAX_CASES.saturating_sub(state.cases),
        )?;
        let PhpTestRunResponse::Ok { suites, .. } = &response else {
            return Err("JavaScript test batch parser returned a non-success result.".to_string());
        };
        let cases = suites.iter().try_fold(0_usize, |count, suite| {
            count
                .checked_add(suite.cases.len())
                .ok_or_else(|| "JavaScript test batch case budget overflowed.".to_string())
        })?;
        state.suites = state
            .suites
            .checked_add(suites.len())
            .ok_or_else(|| "JavaScript test batch suite budget overflowed.".to_string())?;
        state.cases = state
            .cases
            .checked_add(cases)
            .ok_or_else(|| "JavaScript test batch case budget overflowed.".to_string())?;
        Ok(response)
    }

    pub(super) fn state(&self) -> MutexGuard<'_, BatchProjectionBudgetState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub(super) fn validate_batch_projection(
    packages: &[JsTestBatchPackageResult],
) -> Result<(), String> {
    let mut suite_count = 0_usize;
    let mut case_count = 0_usize;
    let mut text_bytes = 0_u64;
    for package in packages {
        let PhpTestRunResponse::Ok { suites, .. } = &package.response else {
            return Err(
                "JavaScript test batch package returned a non-success projection.".to_string(),
            );
        };
        suite_count = suite_count
            .checked_add(suites.len())
            .ok_or_else(|| "JavaScript test batch suite count overflowed.".to_string())?;
        if suite_count > MAX_SUITES {
            return Err(format!(
                "JavaScript test batch contains {suite_count} suites; the aggregate safety limit is {MAX_SUITES}."
            ));
        }
        for suite in suites {
            case_count = case_count
                .checked_add(suite.cases.len())
                .ok_or_else(|| "JavaScript test batch case count overflowed.".to_string())?;
            if case_count > MAX_CASES {
                return Err(format!(
                    "JavaScript test batch contains {case_count} cases; the aggregate safety limit is {MAX_CASES}."
                ));
            }
            add_text(&mut text_bytes, suite.name.as_deref())?;
            for case in &suite.cases {
                add_text(&mut text_bytes, case.name.as_deref())?;
                add_text(&mut text_bytes, case.classname.as_deref())?;
                add_text(&mut text_bytes, case.file.as_deref())?;
                add_text(&mut text_bytes, case.message.as_deref())?;
            }
        }
    }
    Ok(())
}

fn add_text(total: &mut u64, value: Option<&str>) -> Result<(), String> {
    *total = total
        .checked_add(value.map_or(0, |value| value.len() as u64))
        .ok_or_else(|| "JavaScript test batch text size overflowed.".to_string())?;
    if *total > MAX_REPORT_BYTES {
        return Err(format!(
            "JavaScript test batch projected text exceeds the aggregate {MAX_REPORT_BYTES} byte safety limit."
        ));
    }
    Ok(())
}
