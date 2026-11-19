# Stage 1: Build
FROM node:24-alpine AS build

WORKDIR /app

# better-sqlite3 does not publish a musl binary for every Node/Alpine patch
# combination, so keep the native toolchain available for a source build.
RUN apk add --no-cache python3 make g++

# Copy package files for all workspaces
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY app/ app/
COPY server/ server/

ARG BUILD_REVISION=development
ENV VITE_BUILD_REVISION=${BUILD_REVISION}
ARG VITE_SPOTIFY_CLASSIC_URL
ENV VITE_SPOTIFY_CLASSIC_URL=${VITE_SPOTIFY_CLASSIC_URL}

# Build shared, then app, then server
RUN npm run build

# Stage 2: Production
FROM node:24-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/

# Install production dependencies only. Remove the temporary native build
# toolchain after better-sqlite3 has compiled.
RUN apk add --no-cache --virtual .native-build-deps python3 make g++ && \
    npm ci --omit=dev && \
    apk del .native-build-deps

# Copy built shared library
COPY --from=build /app/shared/dist/ shared/dist/

# Copy compiled server
COPY --from=build /app/server/dist/ server/dist/

# Copy built client app
COPY --from=build /app/app/dist/ app/dist/

# Copy data directory to a seed location (volume mount will shadow /app/data)
COPY data/ data-seed/

# Startup script: seed volume from data-seed if songs.json is missing
RUN printf '#!/bin/sh\nif [ ! -f /app/data/songs.json ]; then\n  mkdir -p /app/data\n  cp -r /app/data-seed/* /app/data/\n  echo "Seeded /app/data from data-seed"\nfi\nexec node server/dist/index.js\n' > /app/start.sh && chmod +x /app/start.sh

ENV NODE_ENV=production
ARG BUILD_REVISION=development
ENV BUILD_REVISION=${BUILD_REVISION}

EXPOSE 3000

CMD ["/app/start.sh"]
