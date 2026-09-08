use std::time::Duration;

use tokio::sync::{mpsc, watch};

use crate::models::{
    FaultInjection, PROTOCOL_VERSION, RecipeNode, ServerMessage, StepConfig, Telemetry,
    timestamp_ms,
};

#[derive(Debug, PartialEq)]
enum StepOutcome {
    Completed,
    Cancelled {
        simulated_time_ms: u64,
    },
    Failed {
        code: &'static str,
        message: String,
        simulated_time_ms: u64,
    },
    ChannelClosed,
}

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

fn out_of_range_telemetry(step: &StepConfig) -> Telemetry {
    match step {
        StepConfig::SpinCoat { .. } => Telemetry::SpinCoat { rpm: 25_000.0 },
        StepConfig::Bake { .. } => Telemetry::Bake {
            temperature_c: 525.0,
        },
        StepConfig::Expose { .. } => Telemetry::Expose {
            intensity_mw_cm2: 1_250.0,
        },
    }
}

async fn send_event(tx: &mpsc::Sender<ServerMessage>, message: ServerMessage) -> bool {
    tx.send(message).await.is_ok()
}

fn cancellation_requested(cancel: &watch::Receiver<bool>) -> bool {
    *cancel.borrow()
}

async fn wait_for_tick_or_cancel(
    tick_duration: Duration,
    cancel: &mut watch::Receiver<bool>,
) -> bool {
    if cancellation_requested(cancel) {
        return true;
    }

    tokio::select! {
        _ = tokio::time::sleep(tick_duration) => false,
        changed = cancel.changed() => changed.is_ok() && cancellation_requested(cancel),
    }
}

async fn run_step(
    run_id: &str,
    node: &RecipeNode,
    simulated_offset_ms: u64,
    time_scale: f64,
    fault: Option<FaultInjection>,
    cancel: &mut watch::Receiver<bool>,
    tx: &mpsc::Sender<ServerMessage>,
) -> StepOutcome {
    if cancellation_requested(cancel) {
        return StepOutcome::Cancelled {
            simulated_time_ms: simulated_offset_ms,
        };
    }

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
        return StepOutcome::ChannelClosed;
    }

    let duration_sec = node.step.duration_sec();
    let fault_at_sec = (duration_sec / 2).max(1);
    let tick_duration = Duration::from_secs_f64(1.0 / time_scale);

    for sec in 1..=duration_sec {
        if wait_for_tick_or_cancel(tick_duration, cancel).await {
            return StepOutcome::Cancelled {
                simulated_time_ms: simulated_offset_ms + (sec - 1) * 1_000,
            };
        }

        let simulated_time_ms = simulated_offset_ms + sec * 1_000;
        if sec == fault_at_sec {
            match fault {
                Some(FaultInjection::ToolFault) => {
                    return StepOutcome::Failed {
                        code: "tool_fault",
                        message: format!(
                            "Simulated interlock trip on tool {} during {}",
                            node.tool_id, node.label
                        ),
                        simulated_time_ms,
                    };
                }
                Some(FaultInjection::SensorOutOfRange) => {
                    if !send_event(
                        tx,
                        ServerMessage::StepProgress {
                            schema_version: PROTOCOL_VERSION,
                            run_id: run_id.to_string(),
                            step_id: node.id.clone(),
                            progress_sec: sec,
                            duration_sec,
                            telemetry: out_of_range_telemetry(&node.step),
                            timestamp_ms: timestamp_ms(),
                            simulated_time_ms,
                        },
                    )
                    .await
                    {
                        return StepOutcome::ChannelClosed;
                    }

                    return StepOutcome::Failed {
                        code: "sensor_out_of_range",
                        message: format!(
                            "Simulated out-of-range sensor reading on tool {}",
                            node.tool_id
                        ),
                        simulated_time_ms,
                    };
                }
                None => {}
            }
        }

        if !send_event(
            tx,
            ServerMessage::StepProgress {
                schema_version: PROTOCOL_VERSION,
                run_id: run_id.to_string(),
                step_id: node.id.clone(),
                progress_sec: sec,
                duration_sec,
                telemetry: simulate_telemetry(&node.step, sec),
                timestamp_ms: timestamp_ms(),
                simulated_time_ms,
            },
        )
        .await
        {
            return StepOutcome::ChannelClosed;
        }
    }

    if send_event(
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
    {
        StepOutcome::Completed
    } else {
        StepOutcome::ChannelClosed
    }
}

pub async fn run_recipe(
    run_id: String,
    nodes: Vec<RecipeNode>,
    time_scale: f64,
    fault: Option<FaultInjection>,
    mut cancel: watch::Receiver<bool>,
    tx: mpsc::Sender<ServerMessage>,
) {
    let mut simulated_time_ms = 0_u64;

    for node in &nodes {
        match run_step(
            &run_id,
            node,
            simulated_time_ms,
            time_scale,
            fault,
            &mut cancel,
            &tx,
        )
        .await
        {
            StepOutcome::Completed => {
                simulated_time_ms += node.step.duration_sec() * 1_000;
            }
            StepOutcome::Cancelled { simulated_time_ms } => {
                let _ = send_event(
                    &tx,
                    ServerMessage::RunCancelled {
                        schema_version: PROTOCOL_VERSION,
                        run_id,
                        step_id: Some(node.id.clone()),
                        timestamp_ms: timestamp_ms(),
                        simulated_time_ms,
                    },
                )
                .await;
                return;
            }
            StepOutcome::Failed {
                code,
                message,
                simulated_time_ms,
            } => {
                let _ = send_event(
                    &tx,
                    ServerMessage::RunFailed {
                        schema_version: PROTOCOL_VERSION,
                        run_id,
                        step_id: Some(node.id.clone()),
                        code: code.to_string(),
                        message,
                        timestamp_ms: timestamp_ms(),
                        simulated_time_ms,
                    },
                )
                .await;
                return;
            }
            StepOutcome::ChannelClosed => return,
        }
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
    use tokio::sync::{mpsc, watch};

    use super::{run_recipe, simulate_telemetry};
    use crate::models::{FaultInjection, RecipeNode, ServerMessage, StepConfig, Telemetry};

    fn spin_node(duration_sec: u64) -> RecipeNode {
        RecipeNode {
            id: "spin".to_string(),
            label: "Spin coat".to_string(),
            tool_id: "spinner-1".to_string(),
            step: StepConfig::SpinCoat {
                rpm: 3_000,
                duration_sec,
            },
        }
    }

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

    #[test]
    fn exposure_remains_constant_at_the_configured_intensity() {
        let step = StepConfig::Expose {
            intensity_mw_cm2: 18.5,
            duration_sec: 10,
        };

        assert_eq!(
            simulate_telemetry(&step, 1),
            Telemetry::Expose {
                intensity_mw_cm2: 18.5,
            }
        );
        assert_eq!(
            simulate_telemetry(&step, 10),
            Telemetry::Expose {
                intensity_mw_cm2: 18.5,
            }
        );
    }

    #[tokio::test]
    async fn cancellation_emits_a_terminal_event() {
        let (tx, mut rx) = mpsc::channel(16);
        let (cancel_tx, cancel_rx) = watch::channel(false);
        cancel_tx.send(true).unwrap();

        run_recipe(
            "run-cancel".to_string(),
            vec![spin_node(10)],
            100.0,
            None,
            cancel_rx,
            tx,
        )
        .await;

        assert!(matches!(
            rx.recv().await,
            Some(ServerMessage::RunCancelled { run_id, .. }) if run_id == "run-cancel"
        ));
    }

    #[tokio::test]
    async fn injected_tool_fault_fails_the_run() {
        let (tx, mut rx) = mpsc::channel(16);
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        run_recipe(
            "run-fault".to_string(),
            vec![spin_node(2)],
            100.0,
            Some(FaultInjection::ToolFault),
            cancel_rx,
            tx,
        )
        .await;

        assert!(matches!(
            rx.recv().await,
            Some(ServerMessage::StepStarted { .. })
        ));
        assert!(matches!(
            rx.recv().await,
            Some(ServerMessage::RunFailed { code, .. }) if code == "tool_fault"
        ));
    }

    #[tokio::test]
    async fn sensor_fault_emits_the_bad_sample_before_failing() {
        let (tx, mut rx) = mpsc::channel(16);
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        run_recipe(
            "run-sensor".to_string(),
            vec![spin_node(2)],
            100.0,
            Some(FaultInjection::SensorOutOfRange),
            cancel_rx,
            tx,
        )
        .await;

        assert!(matches!(
            rx.recv().await,
            Some(ServerMessage::StepStarted { .. })
        ));
        assert!(matches!(
            rx.recv().await,
            Some(ServerMessage::StepProgress {
                telemetry: Telemetry::SpinCoat { rpm: 25_000.0 },
                ..
            })
        ));
        assert!(matches!(
            rx.recv().await,
            Some(ServerMessage::RunFailed { code, .. }) if code == "sensor_out_of_range"
        ));
    }

    #[tokio::test]
    async fn successful_run_has_monotonic_simulated_time_and_one_terminal_event() {
        let (tx, mut rx) = mpsc::channel(32);
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        run_recipe(
            "run-success".to_string(),
            vec![spin_node(2), spin_node(1)],
            100.0,
            None,
            cancel_rx,
            tx,
        )
        .await;

        let mut previous_time = 0;
        let mut terminal_count = 0;
        while let Some(message) = rx.recv().await {
            let simulated_time_ms = match message {
                ServerMessage::RunAccepted {
                    simulated_time_ms, ..
                }
                | ServerMessage::StepStarted {
                    simulated_time_ms, ..
                }
                | ServerMessage::StepProgress {
                    simulated_time_ms, ..
                }
                | ServerMessage::StepCompleted {
                    simulated_time_ms, ..
                }
                | ServerMessage::RunCompleted {
                    simulated_time_ms, ..
                }
                | ServerMessage::RunCancelled {
                    simulated_time_ms, ..
                }
                | ServerMessage::RunFailed {
                    simulated_time_ms, ..
                } => simulated_time_ms,
                ServerMessage::ConnectionReady { .. }
                | ServerMessage::RunRejected { .. }
                | ServerMessage::Pong { .. } => continue,
            };
            assert!(simulated_time_ms >= previous_time);
            previous_time = simulated_time_ms;
            if matches!(message, ServerMessage::RunCompleted { .. }) {
                terminal_count += 1;
            }
        }

        assert_eq!(previous_time, 3_000);
        assert_eq!(terminal_count, 1);
    }
}
