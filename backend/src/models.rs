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

#[cfg(test)]
mod tests {
    use super::{ProcessStep, RecipePayload, TelemetryEvent};

    #[test]
    fn deserializes_the_current_recipe_payload() {
        let json = r#"
            {
                "steps": [
                    {
                        "id": "step-1",
                        "action": "spin_coat",
                        "duration_sec": 45,
                        "target_value": 3000
                    }
                ]
            }
        "#;

        let payload: RecipePayload = serde_json::from_str(json).unwrap();

        assert_eq!(payload.steps.len(), 1);
        assert_eq!(payload.steps[0].id, "step-1");
        assert_eq!(payload.steps[0].action, "spin_coat");
        assert_eq!(payload.steps[0].duration_sec, 45);
        assert_eq!(payload.steps[0].target_value, 3000.0);
    }

    #[test]
    fn rejects_a_negative_duration_in_the_current_payload() {
        let json = r#"
            {
                "steps": [
                    {
                        "id": "step-1",
                        "action": "bake",
                        "duration_sec": -1,
                        "target_value": 120
                    }
                ]
            }
        "#;

        assert!(serde_json::from_str::<RecipePayload>(json).is_err());
    }

    #[test]
    fn records_the_current_lowercase_step_completion_status() {
        let step = ProcessStep {
            id: "step-1".to_string(),
            action: "bake".to_string(),
            duration_sec: 60,
            target_value: 120.0,
        };

        let json = serde_json::to_value(TelemetryEvent::complete(&step)).unwrap();

        assert_eq!(json["step_id"], "step-1");
        assert_eq!(json["status"], "complete");
        assert_eq!(json["complete"], true);
    }
}
