# Build stage
FROM node:20-slim AS build
WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# Production stage
FROM node:20-slim
WORKDIR /app

RUN corepack enable pnpm

# Copy built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/drizzle.config.ts ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Create data directory
RUN mkdir -p /app/data/images

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Start server (migrations are applied at startup)
CMD ["node", "dist/server/index.js"]
