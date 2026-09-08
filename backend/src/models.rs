use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;
const MAX_NODES: usize = 64;
const MAX_EDGES: usize = 256;
const MAX_ID_LENGTH: usize = 64;
const MAX_RECIPE_NAME_LENGTH: usize = 80;
const MAX_TOTAL_DURATION_SEC: u64 = 14_400;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Recipe {
    pub schema_version: u16,
    pub recipe_id: String,
    pub name: String,
    pub nodes: Vec<RecipeNode>,
    pub edges: Vec<RecipeEdge>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RecipeNode {
    pub id: String,
    pub label: String,
    pub tool_id: String,
    pub step: StepConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RecipeEdge {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StepConfig {
    SpinCoat {
        rpm: u32,
        duration_sec: u64,
    },
    Bake {
        temperature_c: f64,
        duration_sec: u64,
    },
    Expose {
        intensity_mw_cm2: f64,
        duration_sec: u64,
    },
}

impl StepConfig {
    pub fn duration_sec(&self) -> u64 {
        match self {
            Self::SpinCoat { duration_sec, .. }
            | Self::Bake { duration_sec, .. }
            | Self::Expose { duration_sec, .. } => *duration_sec,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::SpinCoat { .. } => "spin_coat",
            Self::Bake { .. } => "bake",
            Self::Expose { .. } => "expose",
        }
    }

    fn validate(&self) -> Result<(), String> {
        let duration_sec = self.duration_sec();
        if !(1..=3_600).contains(&duration_sec) {
            return Err("duration_sec must be an integer from 1 to 3600".to_string());
        }

        match self {
            Self::SpinCoat { rpm, .. } if !(100..=20_000).contains(rpm) => {
                Err("rpm must be from 100 to 20000".to_string())
            }
            Self::Bake { temperature_c, .. }
                if !temperature_c.is_finite() || !(20.0..=450.0).contains(temperature_c) =>
            {
                Err("temperature_c must be finite and from 20 to 450".to_string())
            }
            Self::Expose {
                intensity_mw_cm2, ..
            } if !intensity_mw_cm2.is_finite() || !(0.01..=1_000.0).contains(intensity_mw_cm2) => {
                Err("intensity_mw_cm2 must be finite and from 0.01 to 1000".to_string())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FaultInjection {
    ToolFault,
    SensorOutOfRange,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SimulationConfig {
    pub time_scale: f64,
    pub fault: Option<FaultInjection>,
}

impl SimulationConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !self.time_scale.is_finite() || !(1.0..=100.0).contains(&self.time_scale) {
            return Err("time_scale must be finite and from 1 to 100".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    RunRecipe {
        schema_version: u16,
        request_id: String,
        recipe: Recipe,
        simulation: SimulationConfig,
    },
    CancelRun {
        schema_version: u16,
        request_id: String,
        run_id: String,
    },
    Ping {
        schema_version: u16,
        request_id: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Telemetry {
    SpinCoat { rpm: f64 },
    Bake { temperature_c: f64 },
    Expose { intensity_mw_cm2: f64 },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    ConnectionReady {
        schema_version: u16,
    },
    RunAccepted {
        schema_version: u16,
        request_id: String,
        run_id: String,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    RunRejected {
        schema_version: u16,
        request_id: Option<String>,
        code: String,
        message: String,
        timestamp_ms: u64,
    },
    StepStarted {
        schema_version: u16,
        run_id: String,
        step_id: String,
        step_kind: String,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    StepProgress {
        schema_version: u16,
        run_id: String,
        step_id: String,
        progress_sec: u64,
        duration_sec: u64,
        telemetry: Telemetry,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    StepCompleted {
        schema_version: u16,
        run_id: String,
        step_id: String,
        telemetry: Telemetry,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    RunCompleted {
        schema_version: u16,
        run_id: String,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    RunCancelled {
        schema_version: u16,
        run_id: String,
        step_id: Option<String>,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    RunFailed {
        schema_version: u16,
        run_id: String,
        step_id: Option<String>,
        code: String,
        message: String,
        timestamp_ms: u64,
        simulated_time_ms: u64,
    },
    Pong {
        schema_version: u16,
        request_id: String,
    },
}

pub fn validate_recipe(recipe: &Recipe) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if recipe.schema_version != PROTOCOL_VERSION {
        errors.push(format!(
            "recipe schema_version must equal {PROTOCOL_VERSION}"
        ));
    }
    if !valid_id(&recipe.recipe_id) {
        errors.push("recipe_id must be 1 to 64 ASCII characters".to_string());
    }

    let trimmed_name = recipe.name.trim();
    if trimmed_name.is_empty() || trimmed_name.chars().count() > MAX_RECIPE_NAME_LENGTH {
        errors.push("recipe name must be 1 to 80 characters".to_string());
    }
    if recipe.nodes.is_empty() || recipe.nodes.len() > MAX_NODES {
        errors.push("recipe must contain 1 to 64 nodes".to_string());
    }
    if recipe.edges.len() > MAX_EDGES {
        errors.push("recipe must contain no more than 256 edges".to_string());
    }

    let mut node_ids = HashSet::new();
    let mut total_duration_sec = 0_u64;
    for node in &recipe.nodes {
        if !valid_id(&node.id) {
            errors.push(format!(
                "node id {:?} must be 1 to 64 ASCII characters",
                node.id
            ));
        }
        if !node_ids.insert(node.id.as_str()) {
            errors.push(format!("duplicate node id {:?}", node.id));
        }
        if node.label.trim().is_empty() || node.label.chars().count() > MAX_RECIPE_NAME_LENGTH {
            errors.push(format!(
                "node {:?} must have a 1 to 80 character label",
                node.id
            ));
        }
        if !valid_id(&node.tool_id) {
            errors.push(format!(
                "node {:?} tool_id must be 1 to 64 ASCII characters",
                node.id
            ));
        }
        if let Err(error) = node.step.validate() {
            errors.push(format!("node {:?}: {error}", node.id));
        }
        total_duration_sec = total_duration_sec.saturating_add(node.step.duration_sec());
    }

    if total_duration_sec > MAX_TOTAL_DURATION_SEC {
        errors.push("recipe exceeds 14400 total step-seconds".to_string());
    }

    let mut edge_ids = HashSet::new();
    let mut endpoint_pairs = HashSet::new();
    for edge in &recipe.edges {
        if !valid_id(&edge.id) {
            errors.push(format!(
                "edge id {:?} must be 1 to 64 ASCII characters",
                edge.id
            ));
        }
        if !edge_ids.insert(edge.id.as_str()) {
            errors.push(format!("duplicate edge id {:?}", edge.id));
        }
        if !node_ids.contains(edge.source.as_str()) || !node_ids.contains(edge.target.as_str()) {
            errors.push(format!("edge {:?} references an unknown node", edge.id));
        }
        if edge.source == edge.target {
            errors.push(format!("edge {:?} is a self-loop", edge.id));
        }
        if !endpoint_pairs.insert((edge.source.as_str(), edge.target.as_str())) {
            errors.push(format!(
                "duplicate edge from {:?} to {:?}",
                edge.source, edge.target
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_LENGTH && id.is_ascii()
}

pub fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{
        ClientMessage, FaultInjection, PROTOCOL_VERSION, Recipe, RecipeEdge, RecipeNode,
        ServerMessage, SimulationConfig, StepConfig, validate_recipe,
    };

    fn valid_recipe() -> Recipe {
        Recipe {
            schema_version: PROTOCOL_VERSION,
            recipe_id: "recipe-1".to_string(),
            name: "Positive photoresist".to_string(),
            nodes: vec![RecipeNode {
                id: "step-1".to_string(),
                label: "Spin coat".to_string(),
                tool_id: "spinner-1".to_string(),
                step: StepConfig::SpinCoat {
                    rpm: 3_000,
                    duration_sec: 45,
                },
            }],
            edges: vec![],
        }
    }

    #[test]
    fn deserializes_a_versioned_run_recipe_message() {
        let json = r#"
            {
                "schema_version": 1,
                "type": "run_recipe",
                "request_id": "request-1",
                "recipe": {
                    "schema_version": 1,
                    "recipe_id": "recipe-1",
                    "name": "Positive photoresist",
                    "nodes": [{
                        "id": "step-1",
                        "label": "Spin coat",
                        "tool_id": "spinner-1",
                        "step": {
                            "kind": "spin_coat",
                            "rpm": 3000,
                            "duration_sec": 45
                        }
                    }],
                    "edges": []
                },
                "simulation": { "time_scale": 10, "fault": null }
            }
        "#;

        let message: ClientMessage = serde_json::from_str(json).unwrap();
        match message {
            ClientMessage::RunRecipe {
                schema_version,
                request_id,
                recipe,
                simulation,
            } => {
                assert_eq!(schema_version, PROTOCOL_VERSION);
                assert_eq!(request_id, "request-1");
                assert_eq!(recipe.nodes.len(), 1);
                assert_eq!(simulation.time_scale, 10.0);
            }
            ClientMessage::CancelRun { .. } | ClientMessage::Ping { .. } => {
                panic!("expected run_recipe")
            }
        }
    }

    #[test]
    fn serializes_a_tagged_server_message() {
        let message = ServerMessage::RunCompleted {
            schema_version: PROTOCOL_VERSION,
            run_id: "run-1".to_string(),
            timestamp_ms: 100,
            simulated_time_ms: 2_000,
        };

        let json = serde_json::to_value(message).unwrap();
        assert_eq!(json["type"], "run_completed");
        assert_eq!(json["schema_version"], PROTOCOL_VERSION);
        assert_eq!(json["run_id"], "run-1");
    }

    #[test]
    fn validates_typed_step_ranges_and_edges() {
        let mut recipe = valid_recipe();
        recipe.edges.push(RecipeEdge {
            id: "bad-edge".to_string(),
            source: "step-1".to_string(),
            target: "missing-step".to_string(),
        });

        let errors = validate_recipe(&recipe).unwrap_err();
        assert!(errors.iter().any(|error| error.contains("unknown node")));
    }

    #[test]
    fn rejects_invalid_simulation_speed() {
        let simulation = SimulationConfig {
            time_scale: 0.0,
            fault: None,
        };

        assert!(simulation.validate().is_err());
    }

    #[test]
    fn deserializes_cancel_and_fault_injection_messages() {
        let cancel: ClientMessage = serde_json::from_str(
            r#"{"schema_version":1,"type":"cancel_run","request_id":"request-2","run_id":"run-1"}"#,
        )
        .unwrap();
        assert!(matches!(
            cancel,
            ClientMessage::CancelRun { run_id, .. } if run_id == "run-1"
        ));

        let fault: SimulationConfig =
            serde_json::from_str(r#"{"time_scale":10,"fault":"sensor_out_of_range"}"#).unwrap();
        assert_eq!(fault.fault, Some(FaultInjection::SensorOutOfRange));
        assert!(fault.validate().is_ok());
    }
}
