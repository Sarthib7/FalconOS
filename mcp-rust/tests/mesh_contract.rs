use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    routing::any,
};
use falcon_mcp_rust::{Config, create_app};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::{net::TcpListener, sync::Mutex};
use tower::ServiceExt;

#[derive(Clone)]
struct Fake {
    records: Arc<Mutex<Vec<Value>>>,
    outage: bool,
}
async fn mesh(
    State(fake): State<Fake>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> (StatusCode, Json<Value>) {
    let method = req.method().to_string();
    let headers = req.headers();
    let origin = headers
        .get("origin")
        .and_then(|x| x.to_str().ok())
        .map(str::to_owned);
    let auth = headers
        .get("authorization")
        .and_then(|x| x.to_str().ok())
        .map(str::to_owned);
    let body = match axum::body::to_bytes(req.into_body(), 65536).await {
        Ok(b) => serde_json::from_slice::<Value>(&b).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let route = format!("/{path}");
    fake.records.lock().await.push(
        json!({"method":method,"route":route,"origin":origin,"authorization":auth,"body":body}),
    );
    if route == "/readyz" {
        return (
            if fake.outage {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                StatusCode::OK
            },
            Json(json!({"status":if fake.outage{"not_ready"}else{"ready"}})),
        );
    }
    if fake.outage {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"secret":"never expose this body"})),
        );
    }
    let body = match route.as_str() {
        "/v1/auth/wallet/challenge" => {
            json!({"challengeId":"12345678-1234-1234-1234-123456789012","message":"Sign this exact message.","expiresAt":"2030-01-01T00:00:00.000Z"})
        }
        "/v1/yield/opportunities" => json!({"opportunities":[],"limits":[]}),
        "/v1/public/graph/live" => {
            json!({"scope":"test","chain":"solana","network":"devnet","graph":{},"programAnalysis":{},"reserveAnalysis":{},"status":"NO_DATA","policyDefinitionId":"id","policyVersion":1,"maxSupplyBaseUnits":"1000000","customGraphsSupported":false,"executionReady":false})
        }
        _ => json!({"ok":true}),
    };
    (StatusCode::OK, Json(body))
}
fn cfg(mesh: String) -> Config {
    Config {
        mesh_url: mesh,
        origin: "http://localhost:8792".into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60000,
        rate_session: 60,
        rate_connect: 10,
        rate_global: 300,
    }
}
async fn rpc(client: &reqwest::Client, url: &str, id: u64, name: &str, args: Value) -> Value {
    let response=client.post(url).header("origin","http://localhost:8792").header("accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}})).send().await.unwrap();
    let status = response.status();
    let text = response.text().await.unwrap();
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("MCP response {status}: {text}; {error}"))
}
#[tokio::test]
async fn fake_mesh_records_exact_routes_and_auth_scoping() {
    let records = Arc::new(Mutex::new(vec![]));
    let fake = Fake {
        records: records.clone(),
        outage: false,
    };
    let upstream = Router::new().route("/{*path}", any(mesh)).with_state(fake);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let app = create_app(cfg(format!("http://{upstream_addr}"))).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let c = reqwest::Client::new();
    let url = format!("http://{addr}/mcp");
    let wallet = "11111111111111111111111111111111";
    let connect = rpc(&c, &url, 1, "falcon_connect", json!({"wallet":wallet})).await;
    assert!(connect["result"].get("isError").is_none());
    let rows = records.lock().await;
    assert_eq!(
        rows[0],
        json!({"method":"POST","route":"/v1/auth/wallet/challenge","origin":"http://localhost:8792","authorization":null,"body":{"address":wallet}})
    );
    drop(rows);
    let _ = rpc(
        &c,
        &url,
        2,
        "falcon_yield_opportunities",
        json!({"session":"wsi1_12345678901234567890"}),
    )
    .await;
    let rows = records.lock().await;
    assert_eq!(rows[1]["route"], "/v1/yield/opportunities");
    assert_eq!(rows[1]["method"], "GET");
    assert_eq!(rows[1]["origin"], Value::Null);
    assert_eq!(rows[1]["authorization"], "Bearer wsi1_12345678901234567890");
}
#[tokio::test]
async fn mesh_error_body_is_sanitized_and_readiness_reports_outage() {
    let records = Arc::new(Mutex::new(vec![]));
    let fake = Fake {
        records,
        outage: true,
    };
    let upstream = Router::new().route("/{*path}", any(mesh)).with_state(fake);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let app = create_app(cfg(format!("http://{upstream_addr}"))).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let c = reqwest::Client::new();
    let url = format!("http://{addr}/mcp");
    let result = rpc(&c, &url, 1, "falcon_public_graph", json!({})).await["result"].clone();
    assert_eq!(result["isError"], true);
    assert_eq!(result["structuredContent"]["code"], "MESH_UNAVAILABLE");
    assert!(!result.to_string().contains("never expose this body"));
    let ready = c.get(format!("http://{addr}/readyz")).send().await.unwrap();
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        ready.json::<Value>().await.unwrap(),
        json!({"status":"not_ready"})
    );
}
#[tokio::test]
async fn body_host_origin_and_readiness_guards_fail_closed() {
    let app = create_app(cfg("http://127.0.0.1:9".into())).unwrap();
    let request = |host: &str, origin: &str, body: Body| {
        Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("host", host)
            .header("origin", origin)
            .body(body)
            .unwrap()
    };
    let too_large = app
        .clone()
        .oneshot(request(
            "localhost:8792",
            "http://localhost:8792",
            Body::from(vec![b'x'; 256 * 1024 + 1]),
        ))
        .await
        .unwrap();
    assert_eq!(too_large.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let bad_host = app
        .clone()
        .oneshot(request(
            "evil.example",
            "http://localhost:8792",
            Body::from("{}"),
        ))
        .await
        .unwrap();
    assert_eq!(bad_host.status(), StatusCode::BAD_REQUEST);
    let bad_origin = app
        .clone()
        .oneshot(request(
            "localhost:8792",
            "http://evil.example",
            Body::from("{}"),
        ))
        .await
        .unwrap();
    assert_eq!(bad_origin.status(), StatusCode::FORBIDDEN);
    let ready = app
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);
}
