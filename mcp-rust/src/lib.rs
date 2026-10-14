use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{HeaderMap, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use futures_util::StreamExt;
use regex::Regex;
use reqwest::{Client, Method};
use rmcp::{
    RoleServer,
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool, ToolAnnotations,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::never::NeverSessionManager,
        tower::{StreamableHttpServerConfig, StreamableHttpService},
    },
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::time::timeout;
use url::Url;
use uuid::Uuid;
mod helpers;
use helpers::*;
mod prep;
pub const TOOL_NAMES: [&str; 14] = [
    "falcon_public_graph",
    "falcon_connect",
    "falcon_connect_verify",
    "falcon_disconnect",
    "falcon_yield_opportunities",
    "falcon_refresh_evidence",
    "falcon_reserve_decision",
    "falcon_prepare_transaction",
    "falcon_submit_signed",
    "falcon_check_receipt",
    "falcon_activity",
    "falcon_wallet_status",
    "falcon_decode_transaction",
    "falcon_self_test",
];
pub const SCHEMA_FINGERPRINT: &str =
    "sha256:8a5230bd2cd9cf373b9a84706759723742a1c9cdf94f482f3752cb427674c09c";
const SESSION_RE: &str = r"^wsi1_[A-Za-z0-9_-]{20,}$";
const UUID_RE: &str =
    r"^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$";
const WALLET_RE: &str = r"^[1-9A-HJ-NP-Za-km-z]{32,44}$";
const USDC_RE: &str = r"^(0|[1-9]\d*)(\.\d{1,6})?$";
const BODY_LIMIT: usize = 256 * 1024;
const FIXTURE: &str = include_str!("../fixtures/node-0.4.0.json");
const SELF_TEST_FIXTURE: &str = include_str!("../fixtures/node-self-test-0.4.0.json");
const INSTRUCTIONS: &str = "FalconOS Solana Devnet tools. The public live market graph is the first functional call and needs no wallet, funds, login, or signer. Call falcon_self_test({}) for versioned capability scope and specific unavailable reasons. Unlisted capabilities are unsupported; metadata does not prove backend availability or action readiness. Call falcon_public_graph({}) first. It reads only fixed public-market evidence; OBSERVED is technical data, not a personalized REVIEW, recommendation, or execution approval. NO_DATA never falls back to an older graph. Custom graph selection is not supported. Policy identifiers and version are graph metadata, not owner mandates or durable decision IDs. Never invent proposed amount, owner maximum, book floor, or evidence-age limit. Reuse an existing unexpired session. Only sign a new wallet-ownership message when one is required for owner-bound adoption, decisions, or execution records; sessions last 30 minutes. For owner-bound flow: falcon_refresh_evidence adopts the public graph into program and reserve records at one exact graphRevision; falcon_reserve_decision requires that analysisId and explicit human-provided scenario values; falcon_prepare_transaction uses the public-only lending route. Supply needs the returned REVIEW decisionId and stays capped at 1 USDC (1000000 base units) on Devnet. Redeem needs fresh adopted public evidence but no decision. For every signature, show the exact message or transaction and get separate human approval. Falcon never holds keys, signs, or broadcasts. The human alone signs and broadcasts the exact registered transaction. falcon_wallet_status, falcon_decode_transaction, falcon_public_graph, and falcon_self_test are public read-only tools. Self-test is metadata only, not health, signer, funds, or transaction readiness.";

#[derive(Clone, Debug)]
pub struct Config {
    pub mesh_url: String,
    pub origin: String,
    pub host: String,
    pub allowed_hosts: Vec<String>,
    pub port: u16,
    pub rate_window: u64,
    pub rate_session: u32,
    pub rate_connect: u32,
    pub rate_global: u32,
}
impl Config {
    pub fn from_env() -> Result<Self, String> {
        let e = std::env::var;
        let host = e("FALCON_MCP_HOST")
            .unwrap_or_else(|_| "127.0.0.1".into())
            .to_ascii_lowercase();
        let allowed_hosts = e("FALCON_MCP_ALLOWED_HOSTS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        let origin =
            e("FALCON_MCP_ORIGIN").map_err(|_| "FALCON_MCP_ORIGIN is required.".to_string())?;
        let o = Url::parse(&origin)
            .map_err(|_| "FALCON_MCP_ORIGIN must be a valid origin.".to_string())?;
        if !matches!(o.scheme(), "http" | "https") || o.origin().ascii_serialization() != origin {
            return Err("FALCON_MCP_ORIGIN must be an exact http(s) origin with no path, such as https://mcp.example.com.".into());
        }
        let mesh =
            e("FALCON_MESH_API_URL").map_err(|_| "FALCON_MESH_API_URL is required.".to_string())?;
        let m = Url::parse(&mesh)
            .map_err(|_| "FALCON_MESH_API_URL must be a valid URL.".to_string())?;
        if !matches!(m.scheme(), "http" | "https")
            || !m.username().is_empty()
            || m.password().is_some()
            || m.query().is_some()
            || m.fragment().is_some()
        {
            return Err("FALCON_MESH_API_URL must be an http(s) URL without credentials, query, or fragment.".into());
        }
        let loopback = matches!(
            m.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        );
        if m.scheme() != "https" && !loopback {
            return Err(
                "FALCON_MESH_API_URL must use https unless it points at a loopback host.".into(),
            );
        }
        let bind_loop = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]");
        if !bind_loop && allowed_hosts.is_empty() {
            return Err("FALCON_MCP_ALLOWED_HOSTS is required when FALCON_MCP_HOST is not a loopback address.".into());
        }
        let hostname=Regex::new(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$|^\[[0-9a-f:]+\]$").unwrap();
        if allowed_hosts.iter().any(|h| !hostname.is_match(h)) {
            return Err("FALCON_MCP_ALLOWED_HOSTS must list bare hostnames without scheme, port or wildcard.".into());
        }
        fn n(name: &str, default: u64, min: u64, max: u64) -> Result<u64, String> {
            let x = std::env::var(name).unwrap_or_default();
            if x.is_empty() {
                return Ok(default);
            }
            let v = x
                .parse::<u64>()
                .map_err(|_| format!("{name} must be an integer between {min} and {max}."))?;
            if v < min || v > max {
                return Err(format!(
                    "{name} must be an integer between {min} and {max}."
                ));
            }
            Ok(v)
        }
        Ok(Self {
            mesh_url: mesh.trim_end_matches('/').into(),
            origin,
            host,
            allowed_hosts,
            port: n("PORT", 8792, 0, 65535)? as u16,
            rate_window: n("FALCON_MCP_RATE_WINDOW_MS", 60000, 1, u64::MAX)?,
            rate_session: n("FALCON_MCP_RATE_MAX_PER_SESSION", 60, 1, u32::MAX as u64)? as u32,
            rate_connect: n("FALCON_MCP_RATE_MAX_CONNECT", 10, 1, u32::MAX as u64)? as u32,
            rate_global: n("FALCON_MCP_RATE_MAX_GLOBAL", 300, 1, u32::MAX as u64)? as u32,
        })
    }
}

#[derive(Deserialize)]
struct ToolDef {
    name: String,
    title: String,
    description: String,
    #[serde(rename = "inputSchema")]
    input_schema: Value,
    annotations: Value,
}
#[derive(Clone)]
struct Mesh {
    client: Client,
    base: String,
    origin: String,
}
#[derive(Clone)]
struct AppState {
    config: Config,
    mesh: Mesh,
    limiter: Arc<Mutex<Limiter>>,
}
struct Limiter {
    start: Instant,
    window: Duration,
    global: u32,
    limit_global: u32,
    per_session: u32,
    per_connect: u32,
    counts: HashMap<String, u32>,
}
impl Limiter {
    fn check(&mut self, key: String, connect: bool) -> Result<(), u64> {
        if self.start.elapsed() >= self.window {
            self.start = Instant::now();
            self.global = 0;
            self.counts.clear()
        }
        let v = self.counts.get(&key).copied().unwrap_or(0) + 1;
        let limit = if connect {
            self.per_connect
        } else {
            self.per_session
        };
        if v > limit || self.global >= self.limit_global {
            return Err(self
                .window
                .saturating_sub(self.start.elapsed())
                .as_secs()
                .max(1));
        }
        self.counts.insert(key, v);
        self.global += 1;
        Ok(())
    }
}
impl Mesh {
    fn new(config: &Config) -> Result<Self, String> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "HTTP client unavailable".to_string())?;
        Ok(Self {
            client,
            base: config.mesh_url.clone(),
            origin: config.origin.clone(),
        })
    }
    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        session: Option<&str>,
        special: u64,
    ) -> Result<Value, ToolFailure> {
        let url = format!("{}{}", self.base, path);
        let mut req = self
            .client
            .request(method, &url)
            .header(header::ACCEPT, "application/json");
        if path.starts_with("/v1/auth/wallet/") {
            req = req.header(header::ORIGIN, &self.origin)
        }
        if let Some(s) = session {
            req = req.bearer_auth(s)
        }
        if let Some(b) = body {
            req = req.json(&b)
        }
        timeout(Duration::from_millis(special), async move {
            let response = req.send().await.map_err(|_| ToolFailure::unavailable())?;
            let status = response.status();
            let retry = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| {
                    if s.len() <= 6 && s.bytes().all(|c| c.is_ascii_digit()) {
                        s.parse().ok()
                    } else {
                        None
                    }
                });
            if response
                .content_length()
                .is_some_and(|n| n > 8 * 1024 * 1024)
            {
                return Err(ToolFailure::unavailable());
            }
            let mut body = Vec::with_capacity(
                response.content_length().unwrap_or(0).min(8 * 1024 * 1024) as usize,
            );
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| ToolFailure::unavailable())?;
                if body.len().saturating_add(chunk.len()) > 8 * 1024 * 1024 {
                    return Err(ToolFailure::unavailable());
                }
                body.extend_from_slice(&chunk)
            }
            let payload = serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null);
            if status.is_success() {
                if payload.is_object() {
                    Ok(payload)
                } else {
                    Err(ToolFailure::unavailable())
                }
            } else if let Some(error) = payload.get("error") {
                let code = error.get("code").and_then(Value::as_str).unwrap_or("");
                let message = error.get("message").and_then(Value::as_str).unwrap_or("");
                if Regex::new(r"^[A-Z][A-Z0-9_]{1,39}$")
                    .unwrap()
                    .is_match(code)
                    && message.len() <= 500
                {
                    Err(ToolFailure {
                        code: code.into(),
                        message: message.into(),
                        retry,
                    })
                } else {
                    Err(ToolFailure::unavailable())
                }
            } else {
                Err(ToolFailure::unavailable())
            }
        })
        .await
        .map_err(|_| ToolFailure::unavailable())?
    }
    async fn get(&self, path: &str, session: Option<&str>, ms: u64) -> Result<Value, ToolFailure> {
        self.request(Method::GET, path, None, session, ms).await
    }
    async fn post(
        &self,
        path: &str,
        body: Value,
        session: Option<&str>,
        ms: u64,
    ) -> Result<Value, ToolFailure> {
        self.request(Method::POST, path, Some(body), session, ms)
            .await
    }
    async fn ready(&self) -> bool {
        timeout(Duration::from_secs(5), async {
            let response = self
                .client
                .get(format!("{}/readyz", self.base))
                .send()
                .await
                .ok()?;
            if !response.status().is_success()
                || response
                    .content_length()
                    .is_some_and(|n| n > 8 * 1024 * 1024)
            {
                return Some(false);
            }
            let mut size = 0usize;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.ok()?;
                size = size.saturating_add(chunk.len());
                if size > 8 * 1024 * 1024 {
                    return Some(false);
                }
            }
            Some(true)
        })
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
    }
}
#[derive(Clone)]
struct ToolFailure {
    code: String,
    message: String,
    retry: Option<u64>,
}
impl ToolFailure {
    fn unavailable() -> Self {
        Self {
            code: "MESH_UNAVAILABLE".into(),
            message: "The Falcon Mesh API did not respond. Retry shortly.".into(),
            retry: None,
        }
    }
    fn input(m: impl Into<String>) -> Self {
        Self {
            code: "INVALID_INPUT".into(),
            message: m.into(),
            retry: None,
        }
    }
    fn object(&self) -> Value {
        let mut v = json!({"code":self.code,"message":self.message});
        if let Some(n) = self.retry {
            v["retryAfterSeconds"] = json!(n)
        }
        v
    }
}

fn json_object(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}
fn canonical(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        Value::Object(o) => {
            let mut m = Map::new();
            let mut keys = o.keys().collect::<Vec<_>>();
            keys.sort();
            for k in keys {
                m.insert(k.clone(), canonical(&o[k]));
            }
            Value::Object(m)
        }
        _ => v.clone(),
    }
}
fn fingerprint(tools: &[ToolDef]) -> String {
    let mut ts = tools
        .iter()
        .map(|t| json!({"name":t.name,"inputSchema":t.input_schema}))
        .collect::<Vec<_>>();
    ts.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let bytes = serde_json::to_vec(&canonical(&Value::Array(ts))).unwrap();
    format!("sha256:{}", hex(&Sha256::digest(bytes)))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn tool_defs() -> &'static [ToolDef] {
    static TOOLS: OnceLock<Vec<ToolDef>> = OnceLock::new();
    TOOLS.get_or_init(|| serde_json::from_str(FIXTURE).expect("checked in Node tool fixture"))
}
fn to_tool(d: &ToolDef) -> Tool {
    let schema = d.input_schema.as_object().cloned().unwrap_or_default();
    let tool = Tool::new(d.name.clone(), d.description.clone(), schema).with_title(d.title.clone());
    let a = &d.annotations;
    let mut ann = ToolAnnotations::default();
    if let Some(b) = a.get("readOnlyHint").and_then(Value::as_bool) {
        ann = ann.read_only(b)
    }
    if let Some(b) = a.get("destructiveHint").and_then(Value::as_bool) {
        ann = ann.destructive(b)
    }
    if let Some(b) = a.get("openWorldHint").and_then(Value::as_bool) {
        ann = ann.open_world(b)
    }
    tool.with_annotations(ann)
}

pub fn create_app(config: Config) -> Result<Router, String> {
    let mesh = Mesh::new(&config)?;
    let st = Arc::new(AppState {
        limiter: Arc::new(Mutex::new(Limiter {
            start: Instant::now(),
            window: Duration::from_millis(config.rate_window),
            global: 0,
            limit_global: config.rate_global,
            per_session: config.rate_session,
            per_connect: config.rate_connect,
            counts: HashMap::new(),
        })),
        config,
        mesh,
    });
    Ok(Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(ready))
        .route("/mcp", any(mcp))
        .with_state(st))
}
async fn health() -> Response {
    (
        StatusCode::OK,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Json(json!({"status":"alive"})),
    )
        .into_response()
}
async fn ready(State(st): State<Arc<AppState>>) -> Response {
    if st.mesh.ready().await {
        (
            StatusCode::OK,
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            Json(json!({"status":"ready"})),
        )
            .into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            Json(json!({"status":"not_ready"})),
        )
            .into_response()
    }
}
async fn mcp(State(st): State<Arc<AppState>>, req: Request<Body>) -> Response {
    let headers = req.headers();
    let header_bytes: usize = headers
        .iter()
        .map(|(k, v)| k.as_str().len() + v.as_bytes().len() + 4)
        .sum();
    if header_bytes > 8192 {
        return simple(
            StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE,
            "REQUEST_HEADERS_TOO_LARGE",
            "Request headers too large.",
        );
    }
    if !host_allowed(headers, &st.config) {
        let host = headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| Url::parse(&format!("http://{value}")).ok())
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_default();
        return mcp_guard_error(format!("Invalid Host: {host}"));
    }
    if !origin_allowed(headers, &st.config) {
        let origin = headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| Url::parse(value).ok())
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_default();
        return mcp_guard_error(format!("Invalid Origin: {origin}"));
    }
    let len = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok());
    if len.is_some_and(|n| n > BODY_LIMIT) {
        return simple(
            StatusCode::PAYLOAD_TOO_LARGE,
            "PAYLOAD_TOO_LARGE",
            "Request body too large.",
        );
    }
    let (parts, body) = req.into_parts();
    let bytes = match timeout(
        Duration::from_secs(30),
        axum::body::to_bytes(body, BODY_LIMIT),
    )
    .await
    {
        Ok(Ok(x)) => x,
        Ok(Err(_)) => {
            return simple(
                StatusCode::PAYLOAD_TOO_LARGE,
                "PAYLOAD_TOO_LARGE",
                "Request body too large.",
            );
        }
        Err(_) => {
            return simple(
                StatusCode::REQUEST_TIMEOUT,
                "REQUEST_TIMEOUT",
                "Request timed out.",
            );
        }
    };
    let req = Request::from_parts(parts, Body::from(bytes));
    let h = FalconHandler { state: st.clone() };
    let mut hosts = st.config.allowed_hosts.clone();
    if matches!(
        st.config.host.as_str(),
        "localhost" | "127.0.0.1" | "::1" | "[::1]"
    ) {
        hosts.extend([
            "localhost".into(),
            "127.0.0.1".into(),
            "[::1]".into(),
            "::1".into(),
        ]);
    }
    hosts.sort();
    hosts.dedup();
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts(hosts)
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_max_request_body_bytes(BODY_LIMIT);
    let service = StreamableHttpService::new(
        move || Ok(h.clone()),
        Arc::new(NeverSessionManager::default()),
        config,
    );
    let result = service.handle(req).await;
    let (parts, body) = result.into_parts();
    Response::from_parts(parts, Body::new(body))
}
fn host_allowed(h: &HeaderMap, c: &Config) -> bool {
    let Some(v) = h.get(header::HOST).and_then(|x| x.to_str().ok()) else {
        return false;
    };
    let Ok(url) = Url::parse(&format!("http://{v}")) else {
        return false;
    };
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    if matches!(c.host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]")
        && matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1")
    {
        return true;
    }
    c.allowed_hosts
        .iter()
        .any(|x| x.eq_ignore_ascii_case(&host))
}
fn origin_allowed(h: &HeaderMap, c: &Config) -> bool {
    match h.get(header::ORIGIN) {
        None => true,
        Some(v) => v.to_str().ok() == Some(c.origin.as_str()),
    }
}
fn simple(status: StatusCode, code: &str, msg: &str) -> Response {
    (
        status,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Json(json!({"error":{"code":code,"message":msg}})),
    )
        .into_response()
}
fn mcp_guard_error(message: String) -> Response {
    (
        StatusCode::FORBIDDEN,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Json(json!({"jsonrpc":"2.0","error":{"code":-32000,"message":message},"id":null})),
    )
        .into_response()
}

#[derive(Clone)]
struct FalconHandler {
    state: Arc<AppState>,
}
impl ServerHandler for FalconHandler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("falcon-mcp", "0.4.0"))
            .with_instructions(INSTRUCTIONS)
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        Ok(ListToolsResult {
            tools: tool_defs().iter().map(to_tool).collect(),
            ..Default::default()
        })
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        tool_defs().iter().find(|t| t.name == name).map(to_tool)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, rmcp::ErrorData> {
        let name = request.name.to_string();
        let args = serde_json::to_value(request.arguments.unwrap_or_default()).unwrap_or(json!({}));
        let res = dispatch(&self.state, &name, &args).await.map_err(|e| {
            if e.code == "UNAUTHORIZED" && args.get("session").is_some() {
                ToolFailure {
                    code: e.code,
                    message: format!(
                        "{} Sign in again with falcon_connect, then falcon_connect_verify.",
                        e.message
                    ),
                    retry: e.retry,
                }
            } else {
                e
            }
        });
        let (body, is_error) = match res {
            Ok(b) => (b, false),
            Err(e) => (e.object(), true),
        };
        let mut output = json!({"content":[{"type":"text","text":serde_json::to_string_pretty(&body).unwrap_or_else(|_|"{}".into())}],"structuredContent":body});
        if is_error {
            output["isError"] = json!(true)
        }
        let result: CallToolResult = serde_json::from_value(output).map_err(|_| {
            rmcp::ErrorData::internal_error("Tool response serialization failed", None)
        })?;
        Ok(CallToolResponse::Complete(result))
    }
}

async fn dispatch(st: &AppState, name: &str, args: &Value) -> Result<Value, ToolFailure> {
    validate(name, args)?;
    let sess = args.get("session").and_then(Value::as_str);
    let key = if let Some(s) = sess {
        format!("session:{}", hex(&Sha256::digest(s.as_bytes())))
    } else if let Some(w) = args.get("wallet").and_then(Value::as_str) {
        format!("wallet:{w}")
    } else if name == "falcon_connect_verify" {
        format!(
            "challenge:{}",
            args["challengeId"].as_str().unwrap().to_ascii_lowercase()
        )
    } else {
        format!("public:{name}")
    };
    let connect = matches!(
        name,
        "falcon_connect" | "falcon_connect_verify" | "falcon_wallet_status"
    );
    let verdict = match st.limiter.lock() {
        Ok(mut limiter) => limiter.check(key, connect),
        Err(_) => {
            return Err(ToolFailure {
                code: "INTERNAL_ERROR".into(),
                message: "The Falcon MCP server hit an unexpected error.".into(),
                retry: None,
            });
        }
    };
    if let Err(sec) = verdict {
        return Err(ToolFailure {
            code: "RATE_LIMITED".into(),
            message: format!("Rate limit reached. Retry in {sec} seconds."),
            retry: Some(sec),
        });
    }
    let mesh = &st.mesh;
    let id = || Uuid::new_v4().to_string();
    let g = |path: &str, session: Option<&str>, ms: u64| {
        let client = mesh.clone();
        let path = path.to_owned();
        let session = session.map(str::to_owned);
        async move { client.get(&path, session.as_deref(), ms).await }
    };
    let p = |path: &str, body: Value, session: Option<&str>, ms: u64| {
        let client = mesh.clone();
        let path = path.to_owned();
        let session = session.map(str::to_owned);
        async move { client.post(&path, body, session.as_deref(), ms).await }
    };
    match name {
 "falcon_public_graph"=>{let x=g("/v1/public/graph/live",None,15000).await?;Ok(project_graph(&x))},
 "falcon_connect"=>{
  let x=p("/v1/auth/wallet/challenge",json!({"address":args["wallet"]}),None,15000).await?;
  let origin=Url::parse(&mesh.origin).ok();let hostname=origin.as_ref().and_then(Url::host_str).unwrap_or("");let host=match origin.as_ref().and_then(|u|u.port()){Some(port)=>format!("{hostname}:{port}"),None=>hostname.to_owned()};let expires=x["expiresAt"].as_str().unwrap_or("");
  Ok(json!({"challengeId":x["challengeId"],"message":x["message"],"expiresAt":x["expiresAt"],"next":format!("Show the message to your human. Check that it names {host} and contains no transaction, transfer or spending language. The human alone signs these exact UTF-8 message bytes with wallet signMessage, then provides the 64-byte signature to falcon_connect_verify. The challenge expires at {expires}.")}))
 },
 "falcon_connect_verify"=>{let sig=normalize_signature(args["signature"].as_str().unwrap_or(""))?;let x=p("/v1/auth/wallet/verify",json!({"challengeId":args["challengeId"],"signature":sig}),None,15000).await.map_err(|e|if e.code=="UNAUTHORIZED"{ToolFailure{code:e.code,message:format!("{} Call falcon_connect for a new challenge and sign it again.",e.message),retry:e.retry}}else{e})?;Ok(json!({"session":x["sessionToken"],"walletAddress":x["walletAddress"],"expiresAt":x["expiresAt"],"note":"Pass this session to the other falcon_ tools and reuse it until it expires or is revoked; do not sign in again while it remains valid. It lasts 30 minutes and anyone holding it can act as this wallet in Falcon on Devnet. Do not share it. Call falcon_disconnect when finished."}))},
 "falcon_disconnect"=>{p("/v1/auth/wallet/logout",json!({}),sess,15000).await?;Ok(json!({"disconnected":true}))},
 "falcon_yield_opportunities"=>{let mut x=g("/v1/yield/opportunities",sess,15000).await?;let mut limits=vec!["Yield data is indexed by a third-party provider and may be stale, incomplete or wrong.","APY is a reported rate, not a realized return.","Nothing here is guaranteed. Execution through Falcon is Devnet only."].into_iter().map(Value::from).collect::<Vec<_>>();if let Some(a)=x["limits"].as_array(){limits.extend(a.iter().filter(|v|v.is_string()).cloned())}x["limits"]=json!(limits);Ok(x)},
 "falcon_refresh_evidence"=>{let x=p("/v1/public/graph/adopt",json!({"requestId":id(),"reserveRequestId":id()}),sess,15000).await?;Ok(project_adoption(&x))},
 "falcon_reserve_decision"=>{let x=p("/v1/public/decisions/reserve",json!({"requestId":id(),"analysisId":args["analysisId"],"scenario":{"proposedUnits":to_units(args["proposedUsdc"].as_str().unwrap())?,"maxProposedUnits":to_units(args["maxUsdc"].as_str().unwrap())?,"minBookLiquidityUnits":to_units(args["minBookLiquidityUsdc"].as_str().unwrap())?,"maxObservationAgeSeconds":args["maxEvidenceAgeSeconds"]}}),sess,15000).await?;Ok(project_decision(&x,args))},
 "falcon_prepare_transaction"=>prep::prepare(mesh,args).await,
 "falcon_submit_signed"=>{let ident=args["intentId"].as_str().unwrap().to_ascii_lowercase();let rid=args.get("requestId").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(id);let x=p(&format!("/v1/lending/intents/{ident}/submit"),json!({"requestId":rid,"transactionBase64":args["signedTransactionBase64"]}),sess,15000).await?;Ok(json!({"event":public_event(&x["event"]),"next":"Falcon has registered the signed bytes but has not broadcast them and does not return them. Keep the signedTransactionBase64 provided by the human. The human alone reviews and broadcasts those same bytes to Solana Devnet with their own wallet or RPC. If interrupted, the human retries identical bytes while the blockhash remains valid, then call falcon_check_receipt."}))},
 "falcon_check_receipt"=>{let ident=args["intentId"].as_str().unwrap().to_ascii_lowercase();let rid=args.get("requestId").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(id);let x=p(&format!("/v1/lending/intents/{ident}/receipt"),json!({"requestId":rid}),sess,15000).await?;Ok(json!({"event":public_event(&x["event"])}))},
 "falcon_activity"=>{let (d,i)=tokio::join!(g("/v1/decisions",sess,15000),g("/v1/lending/intents",sess,15000));Ok(activity(&d?,&i?))},
 "falcon_wallet_status"=>{let mut b=json!({"wallet":args["wallet"],"chain":"solana","network":"devnet"});if let Some(a)=args.get("forAction"){b["forAction"]=a.clone()}p("/v1/wallet/status",b,None,60000).await},
 "falcon_decode_transaction"=>p("/v1/transactions/decode",json!({"transactionBase64":args["transactionBase64"],"chain":"solana","network":"devnet"}),None,15000).await,
 "falcon_self_test"=>{let expected:Value=serde_json::from_str(SELF_TEST_FIXTURE).unwrap();Ok(json!({"serverVersion":"0.4.0","chain":"solana","network":"devnet","tools":TOOL_NAMES,"toolCount":14,"schemaFingerprint":fingerprint(tool_defs()),"capabilities":expected["capabilities"],"readiness":{"signer":"not_checked","funding":"not_checked","transaction":"not_checked"}}))},
 _=>Err(ToolFailure{code:"NOT_FOUND".into(),message:"Unknown tool.".into(),retry:None})
 }
}
