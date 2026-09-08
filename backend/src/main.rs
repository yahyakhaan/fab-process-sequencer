mod executor;
mod models;
mod server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=info,tower_http=info".into()),
        )
        .json()
        .init();

    let bind_address =
        std::env::var("FAB_BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    let listener = tokio::net::TcpListener::bind(&bind_address).await?;
    let local_address = listener.local_addr()?;
    let (app, control) = server::build_router();

    tracing::info!(address = %local_address, "fab backend started");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(control))
        .await?;
    tracing::info!("fab backend stopped");
    Ok(())
}

async fn shutdown_signal(control: server::ServiceControl) {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to install Ctrl+C handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::error!(%error, "failed to install SIGTERM handler"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }

    tracing::info!("shutdown requested");
    control.begin_shutdown();
}
