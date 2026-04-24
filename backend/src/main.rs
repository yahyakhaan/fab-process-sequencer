mod executor;
mod models;
mod server;

#[tokio::main]
async fn main() {
    let app = server::build_router();

    let addr = "127.0.0.1:3000";
    println!("[fab] Starting backend on ws://{addr}/ws");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
