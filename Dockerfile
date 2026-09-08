# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1.90-bookworm AS backend-builder
WORKDIR /build/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
RUN cargo build --release --locked

FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=backend-builder --chown=65532:65532 /build/backend/target/release/backend /app/fab-process-sequencer
COPY --from=frontend-builder --chown=65532:65532 /build/frontend/dist /app/frontend/dist

ENV FAB_STATIC_DIR=/app/frontend/dist
ENV PORT=10000
EXPOSE 10000
USER 65532:65532

ENTRYPOINT ["/app/fab-process-sequencer"]
