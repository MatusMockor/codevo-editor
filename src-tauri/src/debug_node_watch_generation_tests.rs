use super::*;

const UUID_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

fn endpoint(port: u16, uuid: &str) -> InspectorEndpointFingerprint {
    InspectorEndpointFingerprint::parse(&format!("127.0.0.1:{port}"), uuid).expect("valid endpoint")
}

fn coordinator(timeout: u64, event_limit: u16) -> WatchGenerationCoordinator {
    WatchGenerationCoordinator::new(
        WatchGenerationPolicy::new(timeout, event_limit).expect("valid policy"),
    )
}

fn activate(
    coordinator: &mut WatchGenerationCoordinator,
    endpoint: &InspectorEndpointFingerprint,
    at: u64,
) -> TargetGeneration {
    let WatchGenerationEffect::Activated(generation) = coordinator.handle(
        WatchGenerationEvent::EndpointObserved(endpoint.clone()),
        WatchInstant::from_ticks(at),
    ) else {
        panic!("endpoint should activate")
    };
    generation
}

fn close(
    coordinator: &mut WatchGenerationCoordinator,
    generation: TargetGeneration,
    endpoint: &InspectorEndpointFingerprint,
    at: u64,
) -> WatchGenerationEffect {
    coordinator.handle(
        WatchGenerationEvent::TargetClosed {
            generation,
            endpoint: endpoint.clone(),
        },
        WatchInstant::from_ticks(at),
    )
}

#[test]
fn endpoint_fingerprint_requires_socket_authority_and_canonical_uuid_shape() {
    let lower =
        InspectorEndpointFingerprint::parse("127.0.0.1:9229", UUID_A).expect("valid endpoint");
    let upper = InspectorEndpointFingerprint::parse(
        "127.0.0.1:9229",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    )
    .expect("uppercase UUID is normalized");
    assert_eq!(lower, upper);
    assert_eq!(
        InspectorEndpointFingerprint::parse("localhost:9229", UUID_A),
        Err(EndpointFingerprintError::Authority)
    );
    assert_eq!(
        InspectorEndpointFingerprint::parse("127.0.0.1:9229/path", UUID_A),
        Err(EndpointFingerprintError::Authority)
    );
    assert_eq!(
        InspectorEndpointFingerprint::parse("127.0.0.1:9229", "not-a-uuid"),
        Err(EndpointFingerprintError::Uuid)
    );
    assert_eq!(
        InspectorEndpointFingerprint::parse(
            "127.0.0.1:9229",
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa/"
        ),
        Err(EndpointFingerprintError::Uuid)
    );
    for authority in ["0.0.0.0:9229", "127.0.0.1:0", "[::1]:9229"] {
        assert_eq!(
            InspectorEndpointFingerprint::parse(authority, UUID_A),
            Err(EndpointFingerprintError::Authority),
            "accepted {authority}"
        );
    }
    for value in [
        "http://127.0.0.1:9229/11111111-1111-4111-8111-111111111111",
        "ws://127.0.0.1:9229/11111111-1111-4111-8111-111111111111/extra",
        "ws://127.0.0.1:9229/11111111-1111-4111-8111-111111111111?query",
    ] {
        assert!(
            InspectorEndpointFingerprint::parse_ws_url(value).is_err(),
            "accepted {value}"
        );
    }
}

#[test]
fn endpoint_fingerprint_owns_both_authority_and_uuid_identity() {
    let baseline = endpoint(9229, UUID_A);
    assert_ne!(baseline, endpoint(9230, UUID_A));
    assert_ne!(baseline, endpoint(9229, UUID_B));
}

#[test]
fn policy_rejects_zero_and_unbounded_caps() {
    assert_eq!(
        WatchGenerationPolicy::new(0, 1),
        Err(WatchGenerationPolicyError::InvalidReplacementTimeout)
    );
    assert_eq!(
        WatchGenerationPolicy::new(MAX_REPLACEMENT_TIMEOUT_TICKS + 1, 1),
        Err(WatchGenerationPolicyError::InvalidReplacementTimeout)
    );
    assert_eq!(
        WatchGenerationPolicy::new(1, 0),
        Err(WatchGenerationPolicyError::InvalidEndpointEventLimit)
    );
    assert_eq!(
        WatchGenerationPolicy::new(1, MAX_ENDPOINT_EVENTS + 1),
        Err(WatchGenerationPolicyError::InvalidEndpointEventLimit)
    );
}

#[test]
fn close_then_distinct_endpoint_advances_exactly_one_generation() {
    let first = endpoint(9229, UUID_A);
    let second = endpoint(9230, UUID_B);
    let mut coordinator = coordinator(10, 8);
    let first_generation = activate(&mut coordinator, &first, 1);
    assert_eq!(first_generation.get(), 1);
    assert_eq!(
        close(&mut coordinator, first_generation, &first, 2),
        WatchGenerationEffect::AwaitingReplacement {
            closed_generation: first_generation,
            deadline: WatchInstant::from_ticks(12),
        }
    );
    let second_generation = activate(&mut coordinator, &second, 12);
    assert_eq!(second_generation.get(), 2);
}

#[test]
fn duplicate_current_endpoint_is_ignored_without_advancing_generation() {
    let current = endpoint(9229, UUID_A);
    let mut coordinator = coordinator(10, 4);
    let generation = activate(&mut coordinator, &current, 1);
    assert_eq!(
        coordinator.handle(
            WatchGenerationEvent::EndpointObserved(current.clone()),
            WatchInstant::from_ticks(2)
        ),
        WatchGenerationEffect::IgnoredCurrentEndpoint(generation)
    );
    assert_eq!(
        close(&mut coordinator, generation, &current, 3),
        WatchGenerationEffect::AwaitingReplacement {
            closed_generation: generation,
            deadline: WatchInstant::from_ticks(13),
        }
    );
}

#[test]
fn different_endpoint_while_active_fails_closed_and_cannot_revive() {
    let first = endpoint(9229, UUID_A);
    let second = endpoint(9230, UUID_B);
    let mut coordinator = coordinator(10, 8);
    activate(&mut coordinator, &first, 1);
    let failure = WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
        WatchGenerationFailure::AmbiguousActiveEndpoint,
    ));
    assert_eq!(
        coordinator.handle(
            WatchGenerationEvent::EndpointObserved(second.clone()),
            WatchInstant::from_ticks(2)
        ),
        failure
    );
    assert_eq!(
        coordinator.handle(
            WatchGenerationEvent::EndpointObserved(first),
            WatchInstant::from_ticks(3)
        ),
        failure
    );
}

#[test]
fn repeated_closed_endpoint_is_bounded_and_never_reactivated() {
    let first = endpoint(9229, UUID_A);
    let mut coordinator = coordinator(10, 2);
    let generation = activate(&mut coordinator, &first, 1);
    close(&mut coordinator, generation, &first, 2);
    for at in 3..=4 {
        assert_eq!(
            coordinator.handle(
                WatchGenerationEvent::EndpointObserved(first.clone()),
                WatchInstant::from_ticks(at)
            ),
            WatchGenerationEffect::IgnoredCurrentEndpoint(generation)
        );
    }
    assert_eq!(
        coordinator.handle(
            WatchGenerationEvent::EndpointObserved(first),
            WatchInstant::from_ticks(5)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::EndpointEventOverflow
        ))
    );
}

#[test]
fn active_duplicate_rate_storm_fails_closed_at_the_exact_cap() {
    let current = endpoint(9229, UUID_A);
    let mut coordinator = coordinator(10, 3);
    let generation = activate(&mut coordinator, &current, 1);
    for at in 2..=3 {
        assert_eq!(
            coordinator.handle(
                WatchGenerationEvent::EndpointObserved(current.clone()),
                WatchInstant::from_ticks(at)
            ),
            WatchGenerationEffect::IgnoredCurrentEndpoint(generation)
        );
    }
    assert_eq!(
        coordinator.handle(
            WatchGenerationEvent::EndpointObserved(current),
            WatchInstant::from_ticks(4)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::EndpointEventOverflow
        ))
    );
}

#[test]
fn replacement_deadline_is_inclusive_then_times_out() {
    let first = endpoint(9229, UUID_A);
    let second = endpoint(9230, UUID_B);
    let mut accepted = coordinator(5, 8);
    let generation = activate(&mut accepted, &first, 10);
    close(&mut accepted, generation, &first, 11);
    assert_eq!(
        activate(&mut accepted, &second, 16).get(),
        generation.get() + 1
    );

    let mut expired = coordinator(5, 8);
    let generation = activate(&mut expired, &first, 10);
    close(&mut expired, generation, &first, 11);
    assert_eq!(
        expired.handle(
            WatchGenerationEvent::EndpointObserved(second),
            WatchInstant::from_ticks(17)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::ReplacementTimedOut
        ))
    );
}

#[test]
fn explicit_deadline_event_respects_the_injected_clock_and_times_out_after_deadline() {
    let first = endpoint(9229, UUID_A);
    let mut awaiting = coordinator(5, 8);
    let generation = activate(&mut awaiting, &first, 1);
    close(&mut awaiting, generation, &first, 2);
    assert_eq!(
        awaiting.handle(
            WatchGenerationEvent::DeadlineElapsed,
            WatchInstant::from_ticks(7)
        ),
        WatchGenerationEffect::DeadlinePending {
            deadline: WatchInstant::from_ticks(7)
        }
    );
    assert_eq!(
        awaiting.handle(
            WatchGenerationEvent::DeadlineElapsed,
            WatchInstant::from_ticks(8)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::ReplacementTimedOut
        ))
    );

    let mut active = coordinator(5, 8);
    activate(&mut active, &first, 1);
    assert_eq!(
        active.handle(
            WatchGenerationEvent::DeadlineElapsed,
            WatchInstant::from_ticks(2)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::UnexpectedEvent
        ))
    );
}

#[test]
fn stale_generation_close_is_rejected_without_mutating_current_owner() {
    let first = endpoint(9229, UUID_A);
    let second = endpoint(9230, UUID_B);
    let mut coordinator = coordinator(10, 8);
    let first_generation = activate(&mut coordinator, &first, 1);
    close(&mut coordinator, first_generation, &first, 2);
    let second_generation = activate(&mut coordinator, &second, 3);
    assert_eq!(
        close(&mut coordinator, first_generation, &first, 4),
        WatchGenerationEffect::RejectedStaleGeneration {
            current: second_generation,
            received: first_generation,
        }
    );
    assert!(matches!(
        close(&mut coordinator, second_generation, &second, 5),
        WatchGenerationEffect::AwaitingReplacement { .. }
    ));
}

#[test]
fn future_generation_close_is_rejected_without_mutating_current_owner() {
    let first = endpoint(9229, UUID_A);
    let mut coordinator = coordinator(10, 8);
    let generation = activate(&mut coordinator, &first, 1);
    let future = TargetGeneration(generation.get() + 1);
    assert_eq!(
        close(&mut coordinator, future, &first, 2),
        WatchGenerationEffect::RejectedStaleGeneration {
            current: generation,
            received: future,
        }
    );
    assert!(matches!(
        close(&mut coordinator, generation, &first, 3),
        WatchGenerationEffect::AwaitingReplacement { .. }
    ));
}

#[test]
fn duplicate_close_while_awaiting_is_rejected_as_stale_state_event() {
    let first = endpoint(9229, UUID_A);
    let mut coordinator = coordinator(10, 8);
    let generation = activate(&mut coordinator, &first, 1);
    close(&mut coordinator, generation, &first, 2);
    assert_eq!(
        close(&mut coordinator, generation, &first, 3),
        WatchGenerationEffect::RejectedStaleGeneration {
            current: generation,
            received: generation,
        }
    );
}

#[test]
fn matching_generation_with_wrong_endpoint_fails_closed() {
    let first = endpoint(9229, UUID_A);
    let wrong = endpoint(9230, UUID_B);
    let mut coordinator = coordinator(10, 8);
    let generation = activate(&mut coordinator, &first, 1);
    assert_eq!(
        close(&mut coordinator, generation, &wrong, 2),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::EndpointMismatch
        ))
    );
}

#[test]
fn cancellation_is_terminal_from_every_nonterminal_phase() {
    let first = endpoint(9229, UUID_A);
    for mut coordinator in [
        coordinator(10, 8),
        {
            let mut value = coordinator(10, 8);
            activate(&mut value, &first, 1);
            value
        },
        {
            let mut value = coordinator(10, 8);
            let generation = activate(&mut value, &first, 1);
            close(&mut value, generation, &first, 2);
            value
        },
    ] {
        assert_eq!(
            coordinator.handle(WatchGenerationEvent::Cancel, WatchInstant::from_ticks(3)),
            WatchGenerationEffect::Terminal(WatchGenerationTerminal::Cancelled)
        );
        assert_eq!(
            coordinator.handle(
                WatchGenerationEvent::EndpointObserved(first.clone()),
                WatchInstant::from_ticks(4)
            ),
            WatchGenerationEffect::Terminal(WatchGenerationTerminal::Cancelled)
        );
    }
}

#[test]
fn generation_and_deadline_exhaustion_fail_closed() {
    let first = endpoint(9229, UUID_A);
    let second = endpoint(9230, UUID_B);
    let mut generation_exhausted = coordinator(10, 8);
    generation_exhausted.force_active_generation_for_test(u64::MAX, first.clone());
    close(
        &mut generation_exhausted,
        TargetGeneration(u64::MAX),
        &first,
        1,
    );
    assert_eq!(
        generation_exhausted.handle(
            WatchGenerationEvent::EndpointObserved(second),
            WatchInstant::from_ticks(2)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::GenerationExhausted
        ))
    );

    let mut deadline_exhausted = coordinator(10, 8);
    let generation = activate(&mut deadline_exhausted, &first, u64::MAX);
    assert_eq!(
        close(&mut deadline_exhausted, generation, &first, u64::MAX),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::ReplacementDeadlineExhausted
        ))
    );
}

#[test]
fn non_monotonic_event_time_fails_closed() {
    let first = endpoint(9229, UUID_A);
    let mut coordinator = coordinator(10, 8);
    activate(&mut coordinator, &first, 5);
    assert_eq!(
        coordinator.handle(
            WatchGenerationEvent::EndpointObserved(first),
            WatchInstant::from_ticks(4)
        ),
        WatchGenerationEffect::Terminal(WatchGenerationTerminal::Failed(
            WatchGenerationFailure::NonMonotonicTime
        ))
    );
}

#[test]
fn multiple_replacements_remain_monotonic_and_one_active() {
    let endpoints = [
        endpoint(9229, UUID_A),
        endpoint(9230, UUID_B),
        endpoint(9231, UUID_C),
    ];
    let mut coordinator = coordinator(10, 8);
    let mut generation = activate(&mut coordinator, &endpoints[0], 1);
    for (index, endpoint) in endpoints.iter().enumerate().skip(1) {
        close(
            &mut coordinator,
            generation,
            &endpoints[index - 1],
            (index * 2) as u64,
        );
        let next = activate(&mut coordinator, endpoint, (index * 2 + 1) as u64);
        assert_eq!(next.get(), generation.get() + 1);
        generation = next;
    }
}
