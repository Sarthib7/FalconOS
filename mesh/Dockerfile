FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production
ENV FALCON_MESH_HOST=0.0.0.0
CMD ["node", "server.mjs"]
