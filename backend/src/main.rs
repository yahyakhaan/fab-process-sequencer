use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};
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

    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            println!("Received raw payload: {}", text);

            match serde_json::from_str::<RecipePayload>(&text) {
                Ok(recipe) => {
                    println!(
                        "Successfully parsed recipe with {} steps.",
                        recipe.steps.len()
                    );
                    for step in recipe.steps {
                        println!(
                            "  -> {}: {} for {}s at {}",
                            step.id, step.action, step.duration_sec, step.target_value
                        );
                    }
                }
                Err(e) => {
                    eprintln!("Failed to parse JSON: {}", e);
                }
            }
        }
    }
    println!("Frontend engineer disconnected.");
}
