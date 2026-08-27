# syntax=docker/dockerfile:1

# ── build stage ─────────────────────────────────────────────────────────────
# Compiles the Next.js app. No database is needed at build time (auth pages
# prerender static; everything else is server-rendered on demand).
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── runtime stage ───────────────────────────────────────────────────────────
# Postgres (pgvector) and the Next server in one image. This is a
# demo / self-host convenience container — the DB is local and disposable,
# matching how this project already runs Postgres (see docker-compose.yml).
# For a production topology use managed Postgres and a stateless app image.
FROM pgvector/pgvector:pg17

ENV NODE_MAJOR=22
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The whole built tree, including node_modules — `next start` needs the prod
# deps and the entrypoint runs the seed/migrate scripts via `tsx`.
COPY --from=build /app ./

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_DOMAIN=localhost \
    PGDATA=/var/lib/postgresql/data \
    DATABASE_URL=postgres://cx:cx@127.0.0.1:5432/cx_platform \
    TEST_DATABASE_URL=postgres://cx:cx@127.0.0.1:5432/postgres

EXPOSE 3000
VOLUME ["/var/lib/postgresql/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
