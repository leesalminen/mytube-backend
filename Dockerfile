FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json package.json package-lock.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080
CMD ["node", "dist/server.js"]
