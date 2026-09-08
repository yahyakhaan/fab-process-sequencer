use std::time::Duration;

use tokio::sync::mpsc;

use crate::models::{
    PROTOCOL_VERSION, RecipeNode, ServerMessage, StepConfig, Telemetry, timestamp_ms,
};

fn simulate_telemetry(step: &StepConfig, sec: u64) -> Telemetry {
    let duration_sec = step.duration_sec();
    let progress = sec as f64 / duration_sec as f64;

    match step {
        StepConfig::Bake { temperature_c, .. } => {
            const AMBIENT_C: f64 = 20.0;
            let temperature_c = if progress < 0.2 {
                AMBIENT_C + (temperature_c - AMBIENT_C) * (progress / 0.2)
            } else if progress < 0.9 {
                *temperature_c
            } else {
                AMBIENT_C + (temperature_c - AMBIENT_C) * ((1.0 - progress) / 0.1)
            };
            Telemetry::Bake { temperature_c }
        }
        StepConfig::SpinCoat { rpm, .. } => {
            let rpm = if progress < 0.3 {
                f64::from(*rpm) * (progress / 0.3)
            } else {
                f64::from(*rpm)
            };
            Telemetry::SpinCoat { rpm }
        }
        StepConfig::Expose {
            intensity_mw_cm2, ..
        } => Telemetry::Expose {
            intensity_mw_cm2: *intensity_mw_cm2,
        },
    }
}

async fn send_event(tx: &mpsc::Sender<ServerMessage>, message: ServerMessage) -> bool {
    tx.send(message).await.is_ok()
}

async fn run_step(
    run_id: &str,
    node: &RecipeNode,
    simulated_offset_ms: u64,
    time_scale: f64,
    tx: &mpsc::Sender<ServerMessage>,
) -> bool {
    if !send_event(
        tx,
        ServerMessage::StepStarted {
            schema_version: PROTOCOL_VERSION,
            run_id: run_id.to_string(),
            step_id: node.id.clone(),
            step_kind: node.step.kind_name().to_string(),
            timestamp_ms: timestamp_ms(),
            simulated_time_ms: simulated_offset_ms,
        },
    )
    .await
    {
        return false;
    }

    let duration_sec = node.step.duration_sec();
    let tick_duration = Duration::from_secs_f64(1.0 / time_scale);
    for sec in 1..=duration_sec {
        let telemetry = simulate_telemetry(&node.step, sec);
        if !send_event(
            tx,
            ServerMessage::StepProgress {
                schema_version: PROTOCOL_VERSION,
                run_id: run_id.to_string(),
                step_id: node.id.clone(),
                progress_sec: sec,
                duration_sec,
                telemetry,
                timestamp_ms: timestamp_ms(),
                simulated_time_ms: simulated_offset_ms + sec * 1_000,
            },
        )
        .await
        {
            return false;
        }

        tokio::time::sleep(tick_duration).await;
    }

    send_event(
        tx,
        ServerMessage::StepCompleted {
            schema_version: PROTOCOL_VERSION,
            run_id: run_id.to_string(),
            step_id: node.id.clone(),
            telemetry: simulate_telemetry(&node.step, duration_sec),
            timestamp_ms: timestamp_ms(),
            simulated_time_ms: simulated_offset_ms + duration_sec * 1_000,
        },
    )
    .await
}

pub async fn run_recipe(
    run_id: String,
    nodes: Vec<RecipeNode>,
    time_scale: f64,
    tx: mpsc::Sender<ServerMessage>,
) {
    let mut simulated_time_ms = 0_u64;

    for node in &nodes {
        if !run_step(&run_id, node, simulated_time_ms, time_scale, &tx).await {
            return;
        }
        simulated_time_ms += node.step.duration_sec() * 1_000;
    }

    let _ = send_event(
        &tx,
        ServerMessage::RunCompleted {
            schema_version: PROTOCOL_VERSION,
            run_id,
            timestamp_ms: timestamp_ms(),
            simulated_time_ms,
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::simulate_telemetry;
    use crate::models::{StepConfig, Telemetry};

    #[test]
    fn spin_coat_reaches_its_target() {
        let step = StepConfig::SpinCoat {
            rpm: 3_000,
            duration_sec: 10,
        };

        assert_eq!(
            simulate_telemetry(&step, 10),
            Telemetry::SpinCoat { rpm: 3_000.0 }
        );
    }

    #[test]
    fn bake_returns_to_ambient_after_cooldown() {
        let step = StepConfig::Bake {
            temperature_c: 120.0,
            duration_sec: 10,
        };

        assert_eq!(
            simulate_telemetry(&step, 10),
            Telemetry::Bake {
                temperature_c: 20.0
            }
        );
    }
}
