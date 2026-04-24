use std::time::Duration;
use tokio::sync::mpsc;

use crate::models::{ProcessStep, TelemetryEvent};

/// Compute a physically plausible sensor value for the current tick.
///
/// Each step type has its own curve:
/// - `bake`:      ramp up over first 20%, hold at target for 70%, ramp down last 10%
/// - `spin_coat`: accelerate to target RPM over first 30%, hold for remainder
/// - `expose`:    instant-on at full power (UV lamp), hold flat
/// - default:     linear ramp to target
fn simulate_value(step: &ProcessStep, sec: u64) -> f64 {
    let t = sec as f64 / step.duration_sec as f64; // normalised 0.0 → 1.0

    match step.action.as_str() {
        "bake" => {
            if t < 0.2 {
                // Ramp up
                step.target_value * (t / 0.2)
            } else if t < 0.9 {
                // Hold
                step.target_value
            } else {
                // Cool-down ramp
                step.target_value * ((1.0 - t) / 0.1)
            }
        }
        "spin_coat" => {
            if t < 0.3 {
                // Accelerate
                step.target_value * (t / 0.3)
            } else {
                // Hold at target RPM
                step.target_value
            }
        }
        "expose" => {
            // UV lamp: full power immediately, no ramp
            step.target_value
        }
        _ => step.target_value * t,
    }
}

/// Run a single process step, emitting one telemetry event per simulated second.
async fn run_step(step: &ProcessStep, tx: &mpsc::Sender<String>) {
    for sec in 1..=step.duration_sec {
        let current_value = simulate_value(step, sec);
        let event = TelemetryEvent::tick(step, sec, current_value);

        if let Ok(json) = serde_json::to_string(&event) {
            if tx.send(json).await.is_err() {
                return;
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let done = TelemetryEvent::complete(step);
    if let Ok(json) = serde_json::to_string(&done) {
        let _ = tx.send(json).await;
    }
}

pub async fn run_recipe(steps: Vec<ProcessStep>, tx: mpsc::Sender<String>) {
    for step in &steps {
        run_step(step, &tx).await;

        if tx.is_closed() {
            break;
        }
    }
}
