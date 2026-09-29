use serde::{Deserialize, Serialize};

use super::AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR;
use crate::codex_model_catalog_domain::{
    is_valid_model_id, CodexCatalogModel, CodexCatalogSnapshot, CodexEffort, MAX_MODEL_ID_BYTES,
};

const DEFAULT_CHOICE: &str = "default";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodexModelChoice {
    bytes: [u8; MAX_MODEL_ID_BYTES],
    len: u8,
}

#[allow(non_upper_case_globals)]
impl CodexModelChoice {
    const fn literal(value: &str) -> Self {
        let mut bytes = [0; MAX_MODEL_ID_BYTES];
        let mut index = 0;
        while index < value.len() {
            bytes[index] = value.as_bytes()[index];
            index += 1;
        }
        Self {
            bytes,
            len: value.len() as u8,
        }
    }

    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes[..usize::from(self.len)]).expect("validated ASCII model ID")
    }

    pub fn is_default(&self) -> bool {
        self.as_str() == DEFAULT_CHOICE
    }

    pub const Default: Self = Self::literal(DEFAULT_CHOICE);
    #[cfg(test)]
    pub const Gpt6Astra: Self = Self::literal("gpt-6-astra");
    #[cfg(test)]
    pub const Gpt56Sol: Self = Self::literal("gpt-5.6-sol");
    #[cfg(test)]
    pub const Gpt56Terra: Self = Self::literal("gpt-5.6-terra");
    #[cfg(test)]
    pub const Gpt56Luna: Self = Self::literal("gpt-5.6-luna");
    #[cfg(test)]
    pub const Gpt55: Self = Self::literal("gpt-5.5");
    #[cfg(test)]
    pub const Gpt54: Self = Self::literal("gpt-5.4");
}

impl Default for CodexModelChoice {
    fn default() -> Self {
        Self::Default
    }
}

impl Serialize for CodexModelChoice {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CodexModelChoice {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        if value != DEFAULT_CHOICE && !is_valid_model_id(&value) {
            return Err(serde::de::Error::custom("Invalid Codex model identifier."));
        }
        Ok(Self::literal(&value))
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodexEffortChoice {
    #[default]
    Default,
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

struct EffortSpec {
    effort: CodexEffort,
    wire: &'static str,
    exec_args: &'static [&'static str],
}

const fn spec(
    effort: CodexEffort,
    wire: &'static str,
    exec_args: &'static [&'static str],
) -> Option<EffortSpec> {
    Some(EffortSpec {
        effort,
        wire,
        exec_args,
    })
}

impl CodexEffortChoice {
    pub fn is_default(&self) -> bool {
        *self == Self::Default
    }

    fn spec(self) -> Option<EffortSpec> {
        match self {
            Self::Default => Option::None,
            Self::None => spec(
                CodexEffort::None,
                "none",
                &["-c", "model_reasoning_effort=\"none\""],
            ),
            Self::Minimal => spec(
                CodexEffort::Minimal,
                "minimal",
                &["-c", "model_reasoning_effort=\"minimal\""],
            ),
            Self::Low => spec(
                CodexEffort::Low,
                "low",
                &["-c", "model_reasoning_effort=\"low\""],
            ),
            Self::Medium => spec(
                CodexEffort::Medium,
                "medium",
                &["-c", "model_reasoning_effort=\"medium\""],
            ),
            Self::High => spec(
                CodexEffort::High,
                "high",
                &["-c", "model_reasoning_effort=\"high\""],
            ),
            Self::Xhigh => spec(
                CodexEffort::Xhigh,
                "xhigh",
                &["-c", "model_reasoning_effort=\"xhigh\""],
            ),
            Self::Max => spec(
                CodexEffort::Max,
                "max",
                &["-c", "model_reasoning_effort=\"max\""],
            ),
            Self::Ultra => spec(
                CodexEffort::Ultra,
                "ultra",
                &["-c", "model_reasoning_effort=\"ultra\""],
            ),
        }
    }

    fn effort(self) -> Option<CodexEffort> {
        self.spec().map(|spec| spec.effort)
    }

    pub fn wire_value(self) -> Option<&'static str> {
        self.spec().map(|spec| spec.wire)
    }

    pub fn exec_args(self) -> &'static [&'static str] {
        self.spec().map_or(&[], |spec| spec.exec_args)
    }
}

pub(super) fn resolve_codex_launch(
    catalog: &CodexCatalogSnapshot,
    model: CodexModelChoice,
    effort: CodexEffortChoice,
) -> Result<&CodexCatalogModel, &'static str> {
    let entry = catalog
        .resolve(model.as_str())
        .ok_or(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)?;
    if effort
        .effort()
        .is_some_and(|effort| !entry.supports(effort))
    {
        return Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR);
    }
    Ok(entry)
}

pub(super) fn codex_model_args(model: CodexModelChoice) -> Vec<String> {
    if model.is_default() {
        return Vec::new();
    }
    vec!["-m".to_string(), model.as_str().to_string()]
}
