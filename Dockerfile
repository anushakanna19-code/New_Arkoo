# ============================================================
# Arkoo Prebuild — Multi-Stage Production Dockerfile
# ============================================================

# ── Stage 1: Build Frontend ─────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build Backend ──────────────────────────────────
FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --ignore-scripts
COPY backend/ ./
RUN npm run build

# ── Stage 3: Production ────────────────────────────────────
FROM node:20-alpine AS production

# Install ffmpeg for audio transcoding
RUN apk add --no-cache ffmpeg

# Security: run as non-root user
RUN addgroup -g 1001 -S arkoo && \
    adduser -S arkoo -u 1001 -G arkoo
WORKDIR /app

# Copy backend production files
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/package*.json ./backend/
COPY --from=backend-build /app/backend/config ./backend/config

# Copy frontend build output
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Install production dependencies only
WORKDIR /app/backend
RUN npm ci --omit=dev --ignore-scripts

# Create upload directory
RUN mkdir -p /app/backend/uploads && chown -R arkoo:arkoo /app

# Switch to non-root user
USER arkoo

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/server.js"]
