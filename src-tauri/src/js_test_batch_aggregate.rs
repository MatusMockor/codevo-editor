use super::{
    JsTestBatchOutput, JsTestBatchPackageResult, PhpTestRunResponse, PhpTestTotals,
    CAPTURED_STREAM_BYTES_LIMIT,
};

pub(super) fn aggregate_totals(packages: &[JsTestBatchPackageResult]) -> PhpTestTotals {
    let mut aggregate = packages
        .iter()
        .fold(PhpTestTotals::default(), |mut aggregate, package| {
            let PhpTestRunResponse::Ok { totals, .. } = &package.response else {
                return aggregate;
            };
            aggregate.tests = aggregate.tests.saturating_add(totals.tests);
            aggregate.failures = aggregate.failures.saturating_add(totals.failures);
            aggregate.errors = aggregate.errors.saturating_add(totals.errors);
            aggregate.skipped = aggregate.skipped.saturating_add(totals.skipped);
            aggregate
        });
    aggregate.time = packages
        .iter()
        .map(|package| match &package.response {
            PhpTestRunResponse::Ok { totals, .. } => totals.time,
            PhpTestRunResponse::Unavailable { .. } | PhpTestRunResponse::Error { .. } => None,
        })
        .try_fold(0.0, |sum, time| time.map(|time| sum + time));
    aggregate
}

pub(super) fn aggregate_output<'a>(
    outputs: impl Iterator<Item = &'a JsTestBatchOutput>,
) -> JsTestBatchOutput {
    fn append(target: &mut String, value: &str, truncated: &mut bool) {
        if !target.is_empty() && !value.is_empty() {
            target.push('\n');
        }
        target.push_str(value);
        if target.len() > CAPTURED_STREAM_BYTES_LIMIT {
            let mut start = target.len() - CAPTURED_STREAM_BYTES_LIMIT;
            while !target.is_char_boundary(start) {
                start += 1;
            }
            target.drain(..start);
            *truncated = true;
        }
    }

    let mut aggregate = JsTestBatchOutput::default();
    for output in outputs {
        append(
            &mut aggregate.stdout.text,
            &output.stdout.text,
            &mut aggregate.stdout.truncated,
        );
        append(
            &mut aggregate.stderr.text,
            &output.stderr.text,
            &mut aggregate.stderr.truncated,
        );
        aggregate.stdout.truncated |= output.stdout.truncated;
        aggregate.stderr.truncated |= output.stderr.truncated;
    }
    aggregate
}
