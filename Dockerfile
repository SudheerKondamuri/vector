FROM node:25-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:25-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL
ARG NEXT_PUBLIC_BASE_SEPOLIA_ESCROW_ADDRESS
ARG NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_ADDRESS
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=$NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL \
    NEXT_PUBLIC_BASE_SEPOLIA_ESCROW_ADDRESS=$NEXT_PUBLIC_BASE_SEPOLIA_ESCROW_ADDRESS \
    NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_ADDRESS=$NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_ADDRESS
RUN npm run build

FROM node:25-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends git docker.io postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 vector \
  && useradd --system --uid 1001 --gid vector vector
COPY --from=builder --chown=vector:vector /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=vector:vector /app/node_modules ./node_modules
COPY --from=builder --chown=vector:vector /app/.next ./.next
COPY --from=builder --chown=vector:vector /app/public ./public
COPY --from=builder --chown=vector:vector /app/app ./app
COPY --from=builder --chown=vector:vector /app/components ./components
COPY --from=builder --chown=vector:vector /app/lib ./lib
COPY --from=builder --chown=vector:vector /app/scripts ./scripts
COPY --from=builder --chown=vector:vector /app/db ./db
COPY --from=builder --chown=vector:vector /app/worker ./worker
USER vector
EXPOSE 3000
CMD ["npm", "run", "start:container"]
