# syntax=docker/dockerfile:1

FROM openpolicyagent/opa:1.10.1-static AS opa-bin

FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=opa-bin /opa /usr/local/bin/opa

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY policies ./policies
COPY fixtures ./fixtures
COPY public ./public
COPY scripts ./scripts
COPY src ./src

# Validate and compile OPA Rego policies into policies/policy.wasm
RUN npm run policy:test && npm run policy:build

# Seed sample repo and pre-extract SQLite PROV database for fast Cloud Run cold starts
RUN npm run seed && npm run extract

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/fixtures ./fixtures
COPY --from=builder --chown=node:node /app/policies ./policies
COPY --from=builder --chown=node:node /app/target-project ./target-project
COPY --from=builder --chown=node:node /app/data ./data

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    READ_ONLY_MODE=true \
    SKIP_OPA_AUTOBUILD=true

USER node
EXPOSE 8080

CMD ["npm", "run", "start"]
