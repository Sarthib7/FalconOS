use std::{
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

const MESH: &str = "https://mesh.internal.example";
const ORIGIN: &str = "https://mcp.example.com";

fn run_binary(
    mesh: Option<&str>,
    origin: Option<&str>,
    host: Option<&str>,
    allowed_hosts: Option<&str>,
) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_falcon-mcp-rust"));
    command.env_clear();
    for (key, value) in [
        ("FALCON_MESH_API_URL", mesh),
        ("FALCON_MCP_ORIGIN", origin),
        ("FALCON_MCP_HOST", host),
        ("FALCON_MCP_ALLOWED_HOSTS", allowed_hosts),
    ] {
        if let Some(value) = value {
            command.env(key, value);
        }
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().expect("Rust MCP binary starts");
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if child.try_wait().expect("child process status").is_some() {
            return child.wait_with_output().expect("collect process output");
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let output = child.wait_with_output().expect("collect timed-out output");
            panic!(
                "invalid configuration unexpectedly kept the server running: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn assert_rejected(
    label: &str,
    mesh: Option<&str>,
    origin: Option<&str>,
    host: Option<&str>,
    allowed_hosts: Option<&str>,
) {
    let output = run_binary(mesh, origin, host, allowed_hosts);
    assert_eq!(output.status.code(), Some(1), "{label}");
    assert!(output.stdout.is_empty(), "{label} wrote to stdout");
}

#[test]
fn binary_rejects_missing_or_unsafe_mesh_network_configuration() {
    assert_rejected("missing Mesh URL", None, Some(ORIGIN), None, None);
    assert_rejected(
        "non-HTTPS remote Mesh URL",
        Some("http://mesh.internal.example"),
        Some(ORIGIN),
        None,
        None,
    );
    assert_rejected(
        "malformed Mesh URL",
        Some("not a URL"),
        Some(ORIGIN),
        None,
        None,
    );
    assert_rejected(
        "Mesh URL with credentials",
        Some("https://user:password@mesh.internal.example"),
        Some(ORIGIN),
        None,
        None,
    );
}

#[test]
fn binary_requires_an_exact_http_origin() {
    assert_rejected("missing origin", Some(MESH), None, None, None);
    for origin in [
        "https://mcp.example.com/",
        "https://mcp.example.com/path",
        "mcp.example.com",
        "ftp://mcp.example.com",
    ] {
        assert_rejected("non-origin URL", Some(MESH), Some(origin), None, None);
    }
}

#[test]
fn binary_requires_a_valid_allowlist_for_public_bind_addresses() {
    assert_rejected(
        "public bind without allowlist",
        Some(MESH),
        Some(ORIGIN),
        Some("0.0.0.0"),
        None,
    );
    for allowed_hosts in [
        "https://mcp.example.com",
        "*.example.com",
        "mcp.example.com:443",
        " , ",
    ] {
        assert_rejected(
            "invalid public-bind allowlist",
            Some(MESH),
            Some(ORIGIN),
            Some("0.0.0.0"),
            Some(allowed_hosts),
        );
    }
}
