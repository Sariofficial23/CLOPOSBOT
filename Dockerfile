# Backend image (Fastify API + Telegram bot + report worker).
# Build:  docker build -t clopos-api .
# Run:    docker run -p 3001:3001 -e PORT=3001 --env-file .env clopos-api
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/clopos/package.json packages/clopos/
RUN pnpm install --frozen-lockfile --filter "@cpos/api..."
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @cpos/api build

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0
COPY --from=build --chown=node:node /app /app
WORKDIR /app/apps/api
USER node
# PORT is provided by the platform (Render) — never hardcoded
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
