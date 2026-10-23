import { createServer } from "node:http";

export const FIXTURE_BROKER_TOKEN = "council-worker-fixture-token";
const FIXTURE_ONLY_API_KEY = "not-a-provider-credential";
const SNAPSHOT = {
  generation: 1,
  generatedAt: 1,
  serverNowMs: 1,
  refresher: { enabled: false, intervalMs: 60000, skewMs: 300000, nextSweepInMs: 60000 },
  credentials: [{
    id: 1,
    provider: "openai-codex",
    credential: { type: "api_key", key: FIXTURE_ONLY_API_KEY },
    identityKey: null,
    rotatesInMs: null,
  }],
};

export async function startFixtureBroker() {
  const observedPaths = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    observedPaths.push(pathname);
    if (request.headers.authorization !== `Bearer ${FIXTURE_BROKER_TOKEN}`) {
      response.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (request.method === "GET" && pathname === "/v1/snapshot/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write(`event: snapshot\ndata: ${JSON.stringify({ ...SNAPSHOT, kind: "snapshot" })}\n\n`);
      return;
    }
    if (request.method === "GET" && pathname === "/v1/snapshot") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ETag: '"1"',
      });
      response.end(JSON.stringify(SNAPSHOT));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture broker did not bind a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    token: FIXTURE_BROKER_TOKEN,
    observedPaths,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined));
    }),
  };
}
