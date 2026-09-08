use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::Duration;

use axum::{
    Json, Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use tokio::{
    sync::{Semaphore, mpsc, watch},
    task::JoinHandle,
};
use tower_http::cors::CorsLayer;
use tracing::{Instrument, info, info_span, warn};

use crate::executor::run_recipe;
use crate::models::{
    ClientMessage, PROTOCOL_VERSION, ServerMessage, timestamp_ms, validate_recipe,
};

pub const MAX_CLIENT_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_WRITE_BUFFER_BYTES: usize = 256 * 1024;
const EVENT_QUEUE_CAPACITY: usize = 256;
const MAX_CONCURRENT_RUNS: usize = 32;
const RUN_STOP_TIMEOUT: Duration = Duration::from_secs(2);

static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct AppState {
    ready: Arc<AtomicBool>,
    run_slots: Arc<Semaphore>,
    shutdown: watch::Receiver<bool>,
}

#[derive(Clone)]
pub struct ServiceControl {
    ready: Arc<AtomicBool>,
    shutdown: watch::Sender<bool>,
}

impl ServiceControl {
    pub fn begin_shutdown(&self) {
        self.ready.store(false, Ordering::Release);
        let _ = self.shutdown.send(true);
    }

    #[cfg(test)]
    fn subscribe(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
    }
}

struct ActiveRun {
    run_id: String,
    cancel: watch::Sender<bool>,
    task: JoinHandle<()>,
}

#[derive(Serialize)]
struct StatusBody {
    status: &'static str,
}

pub fn build_router() -> (Router, ServiceControl) {
    build_router_with_run_limit(MAX_CONCURRENT_RUNS)
}

fn build_router_with_run_limit(max_concurrent_runs: usize) -> (Router, ServiceControl) {
    let ready = Arc::new(AtomicBool::new(true));
    let (shutdown, shutdown_rx) = watch::channel(false);
    let state = AppState {
        ready: Arc::clone(&ready),
        run_slots: Arc::new(Semaphore::new(max_concurrent_runs)),
        shutdown: shutdown_rx,
    };
    let control = ServiceControl { ready, shutdown };

    let router = Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(readiness))
        .route("/ws", get(ws_handler))
        .with_state(state)
        .layer(CorsLayer::permissive());

    (router, control)
}

async fn health() -> Json<StatusBody> {
    Json(StatusBody { status: "ok" })
}

async fn readiness(State(state): State<AppState>) -> impl IntoResponse {
    if state.ready.load(Ordering::Acquire) {
        (StatusCode::OK, Json(StatusBody { status: "ready" }))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(StatusBody {
                status: "shutting_down",
            }),
        )
    }
}

async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    if !state.ready.load(Ordering::Acquire) {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    let connection_id = NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed);
    ws.max_message_size(MAX_CLIENT_MESSAGE_BYTES)
        .max_frame_size(MAX_FRAME_BYTES)
        .max_write_buffer_size(MAX_WRITE_BUFFER_BYTES)
        .on_upgrade(move |socket| {
            handle_socket(socket, state).instrument(info_span!("websocket", connection_id))
        })
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    info!("client connected");
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(EVENT_QUEUE_CAPACITY);
    let mut active_run: Option<ActiveRun> = None;
    let mut shutdown = state.shutdown.clone();

    if *shutdown.borrow() {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

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
            changed = shutdown.changed() => {
                if changed.is_ok() && *shutdown.borrow() {
                    info!("closing connection for server shutdown");
                    let _ = socket.send(Message::Close(None)).await;
                    break;
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        handle_client_message(&text, &tx, &mut active_run, &state).await;
                    }
                    Some(Ok(Message::Binary(_))) => {
                        reject(
                            &tx,
                            None,
                            "unsupported_message_type",
                            "Only text protocol messages are supported",
                        )
                        .await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("client disconnected");
                        break;
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                    Some(Err(error)) => {
                        warn!(%error, "websocket error");
                        break;
                    }
                }
            }
            Some(message) = rx.recv() => {
                let terminal_run_id = terminal_run_id(&message).map(str::to_owned);
                log_terminal_event(&message);
                if send_to_socket(&mut socket, message).await.is_err() {
                    break;
                }
                if terminal_run_id.as_deref() == active_run.as_ref().map(|run| run.run_id.as_str())
                    && let Some(run) = active_run.take()
                {
                    let _ = run.task.await;
                }
            }
        }
    }

    stop_active_run(active_run).await;
}

async fn stop_active_run(active_run: Option<ActiveRun>) {
    let Some(run) = active_run else {
        return;
    };

    let run_id = run.run_id.clone();
    let _ = run.cancel.send(true);
    let mut task = run.task;
    if tokio::time::timeout(RUN_STOP_TIMEOUT, &mut task)
        .await
        .is_err()
    {
        warn!(%run_id, "run did not stop before timeout; aborting task");
        task.abort();
        let _ = task.await;
    }
}

async fn handle_client_message(
    text: &str,
    tx: &mpsc::Sender<ServerMessage>,
    active_run: &mut Option<ActiveRun>,
    state: &AppState,
) {
    if text.len() > MAX_CLIENT_MESSAGE_BYTES {
        warn!(
            payload_bytes = text.len(),
            "rejected oversized client message"
        );
        reject(
            tx,
            None,
            "payload_too_large",
            "Message exceeds the 65536-byte limit",
        )
        .await;
        return;
    }

    let message = match serde_json::from_str::<ClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            warn!(%error, "failed to parse client message");
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

            let permit = match Arc::clone(&state.run_slots).try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => {
                    reject(
                        tx,
                        Some(request_id),
                        "server_busy",
                        "The simulator is at its concurrent run limit; retry shortly",
                    )
                    .await;
                    return;
                }
            };

            let run_id = format!("run-{}", NEXT_RUN_ID.fetch_add(1, Ordering::Relaxed));
            info!(%run_id, node_count = recipe.nodes.len(), "run accepted");

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
            let time_scale = simulation.time_scale;
            let nodes = recipe.nodes;
            let (cancel_tx, cancel_rx) = watch::channel(false);
            let task_run_id = run_id.clone();
            let task = tokio::spawn(
                async move {
                    let _permit = permit;
                    run_recipe(task_run_id, nodes, time_scale, fault, cancel_rx, tx_clone).await;
                }
                .instrument(info_span!("run", run_id = %run_id)),
            );
            *active_run = Some(ActiveRun {
                run_id,
                cancel: cancel_tx,
                task,
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
                    info!(%run_id, "run cancellation requested");
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

fn log_terminal_event(message: &ServerMessage) {
    match message {
        ServerMessage::RunCompleted { run_id, .. } => {
            info!(%run_id, outcome = "completed", "run finished");
        }
        ServerMessage::RunCancelled { run_id, .. } => {
            info!(%run_id, outcome = "cancelled", "run finished");
        }
        ServerMessage::RunFailed { run_id, code, .. } => {
            warn!(%run_id, %code, outcome = "failed", "run finished");
        }
        _ => {}
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use tokio::task::JoinHandle;
    use tokio_tungstenite::{
        MaybeTlsStream, WebSocketStream, connect_async,
        tungstenite::Message as ClientWebSocketMessage,
    };
    use tower::ServiceExt;

    use super::{
        MAX_CLIENT_MESSAGE_BYTES, ServiceControl, build_router, build_router_with_run_limit,
    };

    type TestSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

    async fn spawn_server(max_runs: usize) -> (String, ServiceControl, JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let address = listener.local_addr().expect("test listener has an address");
        let (app, control) = build_router_with_run_limit(max_runs);
        let mut shutdown = control.subscribe();
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    while shutdown.changed().await.is_ok() {
                        if *shutdown.borrow() {
                            break;
                        }
                    }
                })
                .await
                .expect("test server should run");
        });
        (format!("ws://{address}/ws"), control, task)
    }

    async fn connect(url: &str) -> TestSocket {
        let (mut socket, _) = connect_async(url).await.expect("websocket should connect");
        assert_eq!(next_json(&mut socket).await["type"], "connection_ready");
        socket
    }

    async fn next_json(socket: &mut TestSocket) -> Value {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .expect("server should respond before timeout")
                .expect("websocket should stay open")
                .expect("websocket message should be valid");
            if let ClientWebSocketMessage::Text(text) = message {
                return serde_json::from_str(&text).expect("server should send JSON");
            }
        }
    }

    async fn wait_for_type(socket: &mut TestSocket, expected_type: &str) -> Value {
        loop {
            let message = next_json(socket).await;
            if message["type"] == expected_type {
                return message;
            }
        }
    }

    fn run_request(request_id: &str, duration_sec: u64) -> Value {
        json!({
            "schema_version": 1,
            "type": "run_recipe",
            "request_id": request_id,
            "recipe": {
                "schema_version": 1,
                "recipe_id": "integration-recipe",
                "name": "Integration recipe",
                "nodes": [{
                    "id": "spin",
                    "label": "Spin coat",
                    "tool_id": "spinner-1",
                    "step": {
                        "kind": "spin_coat",
                        "rpm": 3000,
                        "duration_sec": duration_sec
                    }
                }],
                "edges": []
            },
            "simulation": { "time_scale": 100, "fault": null }
        })
    }

    async fn send_json(socket: &mut TestSocket, value: &Value) {
        socket
            .send(ClientWebSocketMessage::Text(value.to_string().into()))
            .await
            .expect("client message should send");
    }

    async fn stop_server(control: ServiceControl, server: JoinHandle<()>) {
        control.begin_shutdown();
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .expect("server should shut down")
            .expect("server task should join");
    }

    #[tokio::test]
    async fn health_and_readiness_reflect_shutdown_state() {
        let (app, control) = build_router();
        let health_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("health request should succeed");
        assert_eq!(health_response.status(), StatusCode::OK);

        let ready_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("readiness request should succeed");
        assert_eq!(ready_response.status(), StatusCode::OK);

        control.begin_shutdown();
        let shutdown_response = app
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("readiness request should succeed");
        assert_eq!(shutdown_response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn websocket_handles_ping_malformed_input_and_cancellation() {
        let (url, control, server) = spawn_server(2).await;
        let mut socket = connect(&url).await;

        socket
            .send(ClientWebSocketMessage::Text("not-json".into()))
            .await
            .expect("malformed message should send");
        assert_eq!(
            wait_for_type(&mut socket, "run_rejected").await["code"],
            "malformed_message"
        );

        send_json(
            &mut socket,
            &json!({"schema_version": 1, "type": "ping", "request_id": "ping-1"}),
        )
        .await;
        assert_eq!(
            wait_for_type(&mut socket, "pong").await["request_id"],
            "ping-1"
        );

        send_json(&mut socket, &run_request("start-1", 30)).await;
        let accepted = wait_for_type(&mut socket, "run_accepted").await;
        let run_id = accepted["run_id"]
            .as_str()
            .expect("accepted run has an id")
            .to_string();

        send_json(&mut socket, &run_request("start-2", 30)).await;
        assert_eq!(
            wait_for_type(&mut socket, "run_rejected").await["code"],
            "run_already_active"
        );

        send_json(
            &mut socket,
            &json!({
                "schema_version": 1,
                "type": "cancel_run",
                "request_id": "cancel-1",
                "run_id": run_id
            }),
        )
        .await;
        assert_eq!(
            wait_for_type(&mut socket, "run_cancelled").await["run_id"],
            run_id
        );

        socket.close(None).await.expect("socket should close");
        stop_server(control, server).await;
    }

    #[tokio::test]
    async fn oversized_websocket_message_is_closed_without_starting_work() {
        let (url, control, server) = spawn_server(1).await;
        let mut socket = connect(&url).await;
        let oversized = "x".repeat(MAX_CLIENT_MESSAGE_BYTES + 1);

        socket
            .send(ClientWebSocketMessage::Text(oversized.into()))
            .await
            .expect("oversized payload should leave the client");
        let response = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("server should close an oversized connection");
        assert!(
            response.is_none()
                || matches!(response, Some(Ok(ClientWebSocketMessage::Close(_))))
                || matches!(response, Some(Err(_)))
        );

        stop_server(control, server).await;
    }

    #[tokio::test]
    async fn global_run_limit_and_disconnect_cleanup_are_enforced() {
        let (url, control, server) = spawn_server(1).await;
        let mut first = connect(&url).await;
        let mut second = connect(&url).await;

        send_json(&mut first, &run_request("start-first", 120)).await;
        wait_for_type(&mut first, "run_accepted").await;

        send_json(&mut second, &run_request("while-busy", 1)).await;
        assert_eq!(
            wait_for_type(&mut second, "run_rejected").await["code"],
            "server_busy"
        );

        first.close(None).await.expect("first socket should close");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            send_json(&mut second, &run_request("after-disconnect", 1)).await;
            let response = next_json(&mut second).await;
            match response["type"].as_str() {
                Some("run_accepted") => break,
                Some("run_rejected") if response["code"] == "server_busy" => {
                    assert!(
                        tokio::time::Instant::now() < deadline,
                        "run slot was not released after disconnect"
                    );
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                other => panic!("unexpected response while waiting for run slot: {other:?}"),
            }
        }
        wait_for_type(&mut second, "run_completed").await;

        second
            .close(None)
            .await
            .expect("second socket should close");
        stop_server(control, server).await;
    }

    #[tokio::test]
    async fn shutdown_closes_active_websockets_and_stops_runs() {
        let (url, control, server) = spawn_server(1).await;
        let mut socket = connect(&url).await;
        send_json(&mut socket, &run_request("shutdown-run", 120)).await;
        wait_for_type(&mut socket, "run_accepted").await;

        control.begin_shutdown();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match socket.next().await {
                    None | Some(Ok(ClientWebSocketMessage::Close(_))) | Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                }
            }
        })
        .await
        .expect("socket should close during shutdown");
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .expect("server should shut down")
            .expect("server task should join");
    }
}
