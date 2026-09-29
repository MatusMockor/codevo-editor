use objc2::runtime::AnyObject;
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

const WEBKIT_TEXT_SUBSTITUTION_DEFAULTS: [&str; 4] = [
    "WebAutomaticQuoteSubstitutionEnabled",
    "WebAutomaticDashSubstitutionEnabled",
    "WebAutomaticTextReplacementEnabled",
    "WebAutomaticSpellingCorrectionEnabled",
];

pub(crate) fn register_code_friendly_text_input_defaults() {
    let keys: Vec<_> = WEBKIT_TEXT_SUBSTITUTION_DEFAULTS
        .iter()
        .map(|key| NSString::from_str(key))
        .collect();
    let disabled = NSNumber::new_bool(false);
    let key_refs: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    let value_refs: Vec<&AnyObject> = keys.iter().map(|_| disabled.as_ref()).collect();
    let defaults = NSDictionary::from_slices(&key_refs, &value_refs);
    // SAFETY: every key is an NSString and every value is an NSNumber, the
    // property-list types -[NSUserDefaults registerDefaults:] accepts.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

#[cfg(test)]
mod tests {
    use super::*;

    use objc2_foundation::NSRegistrationDomain;

    #[test]
    fn registers_webkit_text_substitutions_as_disabled_fallbacks() {
        register_code_friendly_text_input_defaults();

        // SAFETY: NSRegistrationDomain is an immutable Foundation constant.
        let domain = unsafe { NSRegistrationDomain };
        let registered = NSUserDefaults::standardUserDefaults().volatileDomainForName(domain);
        for key in WEBKIT_TEXT_SUBSTITUTION_DEFAULTS {
            let value = registered.objectForKey(&NSString::from_str(key));
            let enabled = value
                .as_deref()
                .and_then(|value| value.downcast_ref::<NSNumber>())
                .map(NSNumber::as_bool);
            assert_eq!(enabled, Some(false), "{key}");
        }
    }
}
