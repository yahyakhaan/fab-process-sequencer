use std::sync::atomic::{AtomicU64, Ordering};

use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use tokio::sync::{mpsc, watch};
use tower_http::cors::CorsLayer;

use crate::executor::run_recipe;
use crate::models::{
    ClientMessage, PROTOCOL_VERSION, ServerMessage, timestamp_ms, validate_recipe,
};

static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);

struct ActiveRun {
    run_id: String,
    cancel: watch::Sender<bool>,
}

pub fn build_router() -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    println!("[server] Client connected.");
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(256);
    let mut active_run: Option<ActiveRun> = None;

    if send_to_socket(
        &mut socket,
        ServerMessage::ConnectionReady {
            schema_version: PROTOCOL_VERSION,
        },
    )
    .await
    .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        handle_client_message(&text, &tx, &mut active_run).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        println!("[server] Client disconnected.");
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        eprintln!("[server] WebSocket error: {error}");
                        break;
                    }
                }
            }
            Some(message) = rx.recv() => {
                let terminal_run_id = terminal_run_id(&message).map(str::to_owned);
                if send_to_socket(&mut socket, message).await.is_err() {
                    break;
                }
                if terminal_run_id.as_deref() == active_run.as_ref().map(|run| run.run_id.as_str()) {
                    active_run = None;
                }
            }
        }
    }

    if let Some(run) = active_run {
        let _ = run.cancel.send(true);
    }
}

async fn handle_client_message(
    text: &str,
    tx: &mpsc::Sender<ServerMessage>,
    active_run: &mut Option<ActiveRun>,
) {
    let message = match serde_json::from_str::<ClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            eprintln!("[server] Failed to parse client message: {error}");
            reject(
                tx,
                None,
                "malformed_message",
                "Message is not valid protocol JSON",
            )
            .await;
            return;
        }
    };

    match message {
        ClientMessage::RunRecipe {
            schema_version,
            request_id,
            recipe,
            simulation,
        } => {
            if schema_version != PROTOCOL_VERSION {
                reject(
                    tx,
                    Some(request_id),
                    "unsupported_schema_version",
                    &format!("schema_version must equal {PROTOCOL_VERSION}"),
                )
                .await;
                return;
            }

            if active_run.is_some() {
                reject(
                    tx,
                    Some(request_id),
                    "run_already_active",
                    "Wait for the active run to finish or cancel it first",
                )
                .await;
                return;
            }

            if let Err(errors) = validate_recipe(&recipe) {
                reject(tx, Some(request_id), "invalid_recipe", &errors.join("; ")).await;
                return;
            }

            if let Err(error) = simulation.validate() {
                reject(tx, Some(request_id), "invalid_parameters", &error).await;
                return;
            }

            let run_id = format!("run-{}", NEXT_RUN_ID.fetch_add(1, Ordering::Relaxed));
            println!(
                "[server] Accepted run {run_id} with {} nodes.",
                recipe.nodes.len()
            );

            if tx
                .send(ServerMessage::RunAccepted {
                    schema_version: PROTOCOL_VERSION,
                    request_id,
                    run_id: run_id.clone(),
                    timestamp_ms: timestamp_ms(),
                    simulated_time_ms: 0,
                })
                .await
                .is_err()
            {
                return;
            }

            let tx_clone = tx.clone();
            let fault = simulation.fault;
            let (cancel_tx, cancel_rx) = watch::channel(false);
            *active_run = Some(ActiveRun {
                run_id: run_id.clone(),
                cancel: cancel_tx,
            });
            tokio::spawn(async move {
                run_recipe(
                    run_id,
                    recipe.nodes,
                    simulation.time_scale,
                    fault,
                    cancel_rx,
                    tx_clone,
                )
                .await;
            });
        }
        ClientMessage::CancelRun {
            schema_version,
            request_id,
            run_id,
        } => {
            if schema_version != PROTOCOL_VERSION {
                reject(
                    tx,
                    Some(request_id),
                    "unsupported_schema_version",
                    &format!("schema_version must equal {PROTOCOL_VERSION}"),
                )
                .await;
                return;
            }

            match active_run {
                Some(run) if run.run_id == run_id => {
                    if run.cancel.send(true).is_err() {
                        reject(
                            tx,
                            Some(request_id),
                            "run_not_found",
                            "The active run has already stopped",
                        )
                        .await;
                    }
                }
                _ => {
                    reject(
                        tx,
                        Some(request_id),
                        "run_not_found",
                        "No matching active run was found",
                    )
                    .await;
                }
            }
        }
        ClientMessage::Ping {
            schema_version,
            request_id,
        } => {
            if schema_version != PROTOCOL_VERSION {
                reject(
                    tx,
                    Some(request_id),
                    "unsupported_schema_version",
                    &format!("schema_version must equal {PROTOCOL_VERSION}"),
                )
                .await;
                return;
            }
            let _ = tx
                .send(ServerMessage::Pong {
                    schema_version: PROTOCOL_VERSION,
                    request_id,
                })
                .await;
        }
    }
}

fn terminal_run_id(message: &ServerMessage) -> Option<&str> {
    match message {
        ServerMessage::RunCompleted { run_id, .. }
        | ServerMessage::RunCancelled { run_id, .. }
        | ServerMessage::RunFailed { run_id, .. } => Some(run_id),
        _ => None,
    }
}

async fn reject(
    tx: &mpsc::Sender<ServerMessage>,
    request_id: Option<String>,
    code: &str,
    message: &str,
) {
    let _ = tx
        .send(ServerMessage::RunRejected {
            schema_version: PROTOCOL_VERSION,
            request_id,
            code: code.to_string(),
            message: message.to_string(),
            timestamp_ms: timestamp_ms(),
        })
        .await;
}

async fn send_to_socket(socket: &mut WebSocket, message: ServerMessage) -> Result<(), axum::Error> {
    let json = serde_json::to_string(&message).map_err(axum::Error::new)?;
    socket.send(Message::Text(json.into())).await
}
