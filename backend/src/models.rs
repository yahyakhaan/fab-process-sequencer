use serde::{Deserialize, Serialize};

/// A single fabrication process step received from the frontend.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProcessStep {
    pub id: String,
    pub action: String, // "bake" | "spin_coat" | "expose" | ...
    pub duration_sec: u64,
    pub target_value: f64, // temperature (°C), RPM, or power (mW)
}

/// Payload sent by the frontend to initiate a fab sequence.
#[derive(Debug, Deserialize)]
pub struct RecipePayload {
    pub steps: Vec<ProcessStep>,
}

/// Telemetry event streamed back to the frontend for every tick.
#[derive(Debug, Serialize)]
pub struct TelemetryEvent {
    pub step_id: String,
    pub progress_sec: u64,
    pub current_value: f64,
    pub status: String,
    pub complete: bool,
}

impl TelemetryEvent {
    pub fn tick(step: &ProcessStep, progress_sec: u64, current_value: f64) -> Self {
        Self {
            step_id: step.id.clone(),
            progress_sec,
            current_value,
            status: step.action.clone(),
            complete: false,
        }
    }

    pub fn complete(step: &ProcessStep) -> Self {
        Self {
            step_id: step.id.clone(),
            progress_sec: step.duration_sec,
            current_value: step.target_value,
            status: "complete".to_string(),
            complete: true,
        }
    }
}
