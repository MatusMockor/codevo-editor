export interface PhpFrameworkRegistrationOrderEntry<TRegistration> {
  readonly registration: TRegistration;
  readonly registrationOrder: number;
}

export type PhpFrameworkRegistrationTiebreak<TRegistration> = (
  left: PhpFrameworkRegistrationOrderEntry<TRegistration>,
  right: PhpFrameworkRegistrationOrderEntry<TRegistration>,
) => number;

export function byRegistrationOrder(
  left: { readonly registrationOrder: number },
  right: { readonly registrationOrder: number },
): number {
  return left.registrationOrder - right.registrationOrder;
}

export function orderPhpFrameworkRegistrationsByPriority<
  TRegistration extends { readonly priority?: number },
>(
  registrations: readonly TRegistration[],
  tiebreak: PhpFrameworkRegistrationTiebreak<TRegistration> = byRegistrationOrder,
): readonly TRegistration[] {
  return registrations
    .map((registration, registrationOrder) => ({
      registration,
      registrationOrder,
    }))
    .sort((left, right) => {
      const priorityDifference =
        (right.registration.priority ?? 0) - (left.registration.priority ?? 0);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return tiebreak(left, right);
    })
    .map(({ registration }) => registration);
}
