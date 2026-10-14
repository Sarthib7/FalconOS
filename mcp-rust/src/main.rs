use falcon_mcp_rust::{Config, create_app};
use hyper::server::conn::http1;
use hyper_util::{
    rt::{TokioIo, TokioTimer},
    service::TowerToHyperService,
};
use std::{
    future::Future,
    io,
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpListener,
    time::{Instant, Sleep, sleep},
};

struct IdleTimeout<T> {
    io: T,
    deadline: Pin<Box<Sleep>>,
    idle: Duration,
}
impl<T> IdleTimeout<T> {
    fn new(io: T, idle: Duration) -> Self {
        Self {
            io,
            deadline: Box::pin(sleep(idle)),
            idle,
        }
    }
}
impl<T: AsyncRead + AsyncWrite + Unpin> AsyncRead for IdleTimeout<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.as_mut().get_mut();
        let before = buf.filled().len();
        let result = Pin::new(&mut this.io).poll_read(cx, buf);
        if matches!(result, Poll::Ready(Ok(()))) && buf.filled().len() > before {
            this.deadline.as_mut().reset(Instant::now() + this.idle)
        }
        if this.deadline.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "keep-alive idle timeout",
            )));
        }
        result
    }
}
impl<T: AsyncRead + AsyncWrite + Unpin> AsyncWrite for IdleTimeout<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.as_mut().get_mut();
        let result = Pin::new(&mut this.io).poll_write(cx, buf);
        if matches!(result,Poll::Ready(Ok(n))if n>0) {
            this.deadline.as_mut().reset(Instant::now() + this.idle)
        }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.as_mut().get_mut().io).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.as_mut().get_mut().io).poll_shutdown(cx)
    }
}

#[tokio::main]
async fn main() {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("falcon-mcp: {error}");
            std::process::exit(1);
        }
    };
    let bind_host = if config.host.contains(':') && !config.host.starts_with('[') {
        format!("[{}]", config.host)
    } else {
        config.host.clone()
    };
    let address = format!("{bind_host}:{}", config.port);
    let app = match create_app(config) {
        Ok(app) => app,
        Err(_) => {
            eprintln!("falcon-mcp: HTTP service failed to start.");
            std::process::exit(1);
        }
    };
    let listener = match TcpListener::bind(&address).await {
        Ok(listener) => listener,
        Err(_) => {
            eprintln!("falcon-mcp: HTTP service failed to start.");
            std::process::exit(1);
        }
    };
    eprintln!(
        "falcon-mcp listening on {}.",
        listener.local_addr().map(|x| x.port()).unwrap_or(0)
    );
    let service = TowerToHyperService::new(app);
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            accepted = listener.accept() => {
                let (stream, _) = match accepted { Ok(pair) => pair, Err(_) => continue };
                let service = service.clone();
                tokio::spawn(async move {
                    let io=TokioIo::new(IdleTimeout::new(stream,Duration::from_secs(65)));
                    let mut builder=http1::Builder::new();
                    builder.keep_alive(true).max_buf_size(8192).timer(TokioTimer::new()).header_read_timeout(Some(Duration::from_secs(10)));
                    let _=builder.serve_connection(io,service).await;
                });
            }
        }
    }
}
