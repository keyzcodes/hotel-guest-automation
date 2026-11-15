# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.15.0
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci --include=dev
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build \
 && npm --prefix frontend prune --omit=dev \
 && mkdir -p frontend/public

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=5000 SERVE_FRONTEND=true NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/package.json backend/package-lock.json backend/server.js ./backend/
COPY --chown=node:node backend/src ./backend/src
COPY --chown=node:node backend/scripts ./backend/scripts
COPY --from=build --chown=node:node /app/frontend/package.json ./frontend/package.json
COPY --from=build --chown=node:node /app/frontend/next.config.ts ./frontend/next.config.ts
COPY --from=build --chown=node:node /app/frontend/node_modules ./frontend/node_modules
COPY --from=build --chown=node:node /app/frontend/.next ./frontend/.next
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public
COPY --chown=node:node deploy/healthcheck.cjs ./deploy/healthcheck.cjs
USER node
EXPOSE 5000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=3 CMD ["node", "deploy/healthcheck.cjs"]
CMD ["node", "backend/server.js"]
