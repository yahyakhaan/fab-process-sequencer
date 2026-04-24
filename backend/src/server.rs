use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use tokio::sync::mpsc;
use tower_http::cors::CorsLayer;

use crate::executor::run_recipe;
use crate::models::RecipePayload;

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

    let (tx, mut rx) = mpsc::channel::<String>(256);

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<RecipePayload>(&text) {
                            Ok(recipe) => {
                                println!("[server] Received recipe with {} steps.", recipe.steps.len());
                                let tx_clone = tx.clone();
                                tokio::spawn(async move {
                                    run_recipe(recipe.steps, tx_clone).await;
                                });
                            }
                            Err(e) => {
                                eprintln!("[server] Failed to parse recipe: {e}");
                            }
                        }
                    }
                    Some(Ok(_)) => {
                    }
                    Some(Err(e)) => {
                        eprintln!("[server] WebSocket error: {e}");
                        break;
                    }
                    None => {
                        println!("[server] Client disconnected.");
                        break;
                    }
                }
            }

            Some(telemetry_json) = rx.recv() => {
                if socket.send(Message::Text(telemetry_json.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}
