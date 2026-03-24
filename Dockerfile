# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files for all workspaces
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy source code
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY app/ app/
COPY server/ server/

# Write VITE env vars for frontend build
RUN echo "VITE_SPOTIFY_CLIENT_ID=e33859f1356b43ccaa5cd1ce2232c4f5" > app/.env && \
    echo "VITE_SERVER_URL=" >> app/.env && \
    echo "VITE_SPOTIFY_REDIRECT_URI=" >> app/.env

# Build shared, then app, then server
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/

# Install production dependencies only
RUN npm install --omit=dev

# Copy built shared library
COPY --from=build /app/shared/dist/ shared/dist/

# Copy compiled server
COPY --from=build /app/server/dist/ server/dist/

# Copy built client app
COPY --from=build /app/app/dist/ app/dist/

# Copy data directory
COPY data/ data/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
