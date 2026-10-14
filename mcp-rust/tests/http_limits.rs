use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use falcon_mcp_rust::{Config, create_app};
use tower::ServiceExt;

#[tokio::test]
async fn mcp_rejects_headers_over_eight_kib() {
    let app = create_app(Config {
        mesh_url: "http://127.0.0.1:9".into(),
        origin: "http://localhost:8792".into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60000,
        rate_session: 60,
        rate_connect: 10,
        rate_global: 300,
    })
    .unwrap();
    let padding = "x".repeat(9_000);
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", "localhost:8792")
        .header("origin", "http://localhost:8792")
        .header("x-padding", padding)
        .body(Body::from("{}"))
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE
    );
}
