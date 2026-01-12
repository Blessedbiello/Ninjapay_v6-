use actix_cors::Cors;
use actix_web::{middleware, web, App, HttpServer};
use std::env;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod error;
mod handlers;
mod mpc;
mod routes;

use config::Config;
use mpc::MpcClient;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            env::var("RUST_LOG").unwrap_or_else(|_| "info,arcium_service=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    // Load configuration
    let config = Config::from_env().expect("Failed to load configuration");
    let port = config.port;
    let host = config.host.clone();

    info!(
        "Starting Arcium Service on {}:{} in {} mode",
        host, port, config.mpc_mode
    );

    // Initialize MPC client
    let mpc_client = MpcClient::new(&config).expect("Failed to initialize MPC client");
    let mpc_client = web::Data::new(mpc_client);
    let config = web::Data::new(config);

    // Start HTTP server
    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .wrap(middleware::Compress::default())
            .app_data(config.clone())
            .app_data(mpc_client.clone())
            .configure(routes::configure)
    })
    .bind(format!("{}:{}", host, port))?
    .run()
    .await
}
