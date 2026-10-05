FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production
ENV FALCON_MCP_HOST=0.0.0.0
# Required at runtime, not baked in: FALCON_MESH_API_URL, FALCON_MCP_ORIGIN and FALCON_MCP_ALLOWED_HOSTS
# (comma-separated public hostnames, for example mcp.example.com). The server refuses to start on
# 0.0.0.0 without FALCON_MCP_ALLOWED_HOSTS. Railway injects PORT.
CMD ["node", "server.mjs"]
