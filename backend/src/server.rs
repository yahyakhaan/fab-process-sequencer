use std::sync::atomic::{AtomicU64, Ordering};

use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use tokio::sync::mpsc;
use tower_http::cors::CorsLayer;

use crate::executor::run_recipe;
use crate::models::{
    ClientMessage, PROTOCOL_VERSION, ServerMessage, timestamp_ms, validate_recipe,
};

static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);

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
                        handle_client_message(&text, &tx).await;
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
                if send_to_socket(&mut socket, message).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn handle_client_message(text: &str, tx: &mpsc::Sender<ServerMessage>) {
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
            tokio::spawn(async move {
                run_recipe(run_id, recipe.nodes, simulation.time_scale, tx_clone).await;
            });
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
