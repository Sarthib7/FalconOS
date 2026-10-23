import { writeFile } from "node:fs/promises";

process.on("SIGTERM", () => {});
await writeFile(process.argv[2], "ready", { mode: 0o600 });
setInterval(() => {}, 1000);
