FROM oven/bun:1.3.14 AS council-bun
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=council-bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY council/runtime/package.json council/runtime/package-lock.json ./council/runtime/
RUN npm ci --prefix council/runtime --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production
ENV FALCON_MESH_HOST=0.0.0.0
ENV FALCON_MESH_COUNCIL_BUN=/usr/local/bin/bun
CMD ["node", "server.mjs"]
