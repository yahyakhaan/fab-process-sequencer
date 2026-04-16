use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;
use tower_http::cors::CorsLayer;

// 1. Data Structures
// #[derive(...)] macros automatically generate the code to convert between JSON and strongly typed Rust structs.
#[derive(Debug, Deserialize, Serialize)]
struct ProcessStep {
    id: String,
    action: String, // e.g., "bake", "spin_coat", "etch"
    duration_sec: u64,
    target_value: f64, // e.g., temperature (C) or speed (RPM)
}

#[derive(Debug, Deserialize)]
struct RecipePayload {
    steps: Vec<ProcessStep>,
}

// outgoing payload
#[derive(Debug, Serialize)]
struct TelemetryEvent {
    step_id: String,
    progress_sec: u64,
    current_value: f64,
    status: String,
}

// 2. Entry Point
// #[tokio::main] sets up the async event loop (similar to Node's event loop)
#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive());

    println!("Starting fab sequencer backend on ws://127.0.0.1:3000/ws");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}

// 3. Route Handler
// This function catches the HTTP request and upgrades it to a WebSocket
async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

// 4. WebSocket Logic
// Runs concurrently for every connected client
async fn handle_socket(mut socket: WebSocket) {
    println!("Frontend engineer connected to the fab!");

    // Create an in-memory channel to act as our telemetry broker
    // tx = transmitter (producer), rx = receiver (consumer)
    let (tx, mut rx) = mpsc::channel::<String>(100);

    // Use tokio::select! to handle multiple async streams concurrently
    loop {
        tokio::select! {
            // Listen for messages from the frontend
            msg = socket.recv() => {
                if let Some(Ok(Message::Text(text))) = msg {
                    if let Ok(recipe) = serde_json::from_str::<RecipePayload>(&text) {
                        println!("Starting recipe simulation...");

                        let tx_clone = tx.clone();

                        // Spawn an isolated background task to run the hardware simulation
                        tokio::spawn(async move {
                            for step in recipe.steps {
                                for sec in 1..=step.duration_sec {
                                    // Simulate hardware ramp-up over time
                                    let progress_ratio = sec as f64 / step.duration_sec as f64;
                                    let current_val = step.target_value * progress_ratio;

                                    let event = TelemetryEvent {
                                        step_id: step.id.clone(),
                                        progress_sec: sec,
                                        current_value: current_val,
                                        status: step.action.clone(),
                                    };

                                    // Serialize the event and publish it to the channel
                                    if let Ok(json) = serde_json::to_string(&event) {
                                        let _ = tx_clone.send(json).await;
                                    }

                                    // Sleep to simulate time passing (sped up for demo)
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                }
                            }
                            // Notify that the recipe is done
                            let _ = tx_clone.send(r#"{"status":"Complete"}"#.to_string()).await;
                        });
                    }
                } else if msg.is_none() {
                    println!("Frontend disconnected.");
                    break; // Exit the loop if the connection closes
                }
            }

            // Listen for telemetry events from the simulation task
            Some(telemetry_json) = rx.recv() => {
                // Forward the internal telemetry directly to the frontend WebSocket
                if socket.send(Message::Text(telemetry_json.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}
