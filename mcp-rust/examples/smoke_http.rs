use falcon_mcp_rust::{SCHEMA_FINGERPRINT, TOOL_NAMES};
use rmcp::{ServiceExt, model::CallToolRequestParams, transport::StreamableHttpClientTransport};
use serde_json::{Value, json};
use std::time::Duration;
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let target = Url::parse(
        &args
            .next()
            .ok_or("usage: smoke_http <MCP_URL> [--mesh-unavailable]")?,
    )?;
    let unavailable = match args.next().as_deref() {
        None => false,
        Some("--mesh-unavailable") => true,
        _ => return Err("unknown smoke option".into()),
    };
    if args.next().is_some()
        || target.path() != "/mcp"
        || target.query().is_some()
        || target.fragment().is_some()
        || !target.username().is_empty()
        || target.password().is_some()
        || !(target.scheme() == "https"
            || (target.scheme() == "http"
                && matches!(target.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
    {
        return Err(
            "use an exact HTTPS /mcp URL, or HTTP loopback, without credentials/query".into(),
        );
    }
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;
    let health = http.get(target.join("/healthz")?).send().await?;
    assert_eq!(health.status(), 200);
    assert_eq!(health.json::<Value>().await?, json!({"status":"alive"}));
    let ready = http.get(target.join("/readyz")?).send().await?;
    assert_eq!(ready.status().as_u16(), if unavailable { 503 } else { 200 });

    let client = ().serve(StreamableHttpClientTransport::from_uri(target.as_str())).await?;
    let tools = client.peer().list_all_tools().await?;
    assert!(tools.iter().map(|tool| tool.name.as_ref()).eq(TOOL_NAMES));
    let metadata = client
        .peer()
        .call_tool(CallToolRequestParams::new("falcon_self_test"))
        .await?;
    assert_ne!(metadata.is_error, Some(true));
    let metadata = metadata
        .structured_content
        .as_ref()
        .ok_or("missing self-test metadata")?;
    assert_eq!(metadata["serverVersion"], "0.4.0");
    assert_eq!(metadata["schemaFingerprint"], SCHEMA_FINGERPRINT);
    assert_eq!(metadata["capabilities"]["schemaVersion"], 1);
    assert_eq!(metadata["capabilities"]["verification"], "metadata-only");
    assert_eq!(metadata["capabilities"]["defaultSupport"], "unsupported");
    assert_eq!(
        metadata["readiness"],
        json!({"signer":"not_checked","funding":"not_checked","transaction":"not_checked"})
    );

    let rejected = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("falcon_public_graph").with_arguments(
                serde_json::Map::from_iter([("source".into(), Value::String("private".into()))]),
            ),
        )
        .await?;
    assert_eq!(rejected.is_error, Some(true));
    assert_eq!(
        rejected
            .structured_content
            .as_ref()
            .ok_or("missing error metadata")?["code"],
        "INVALID_INPUT"
    );

    let graph = client
        .peer()
        .call_tool(CallToolRequestParams::new("falcon_public_graph"))
        .await?;
    let graph_body = graph
        .structured_content
        .as_ref()
        .ok_or("missing graph metadata")?;
    if unavailable {
        assert_eq!(graph.is_error, Some(true));
        assert_eq!(graph_body["code"], "MESH_UNAVAILABLE");
    } else {
        assert_ne!(graph.is_error, Some(true));
        assert!(matches!(
            graph_body["status"].as_str(),
            Some("OBSERVED" | "NO_DATA")
        ));
        assert_eq!(graph_body["executionReady"], false);
    }
    println!(
        "{}",
        json!({"result":"MCP_HTTP_SMOKE_PASS","tools":tools.len(),"serverVersion":metadata["serverVersion"],"meshUnavailable":unavailable,"graphStatus":graph_body.get("status"),"graphError":graph_body.get("code")})
    );
    client.cancel().await?;
    Ok(())
}
