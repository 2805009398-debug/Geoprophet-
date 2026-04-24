FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY backend/tsconfig.json ./backend/tsconfig.json

RUN npm ci --workspace backend

COPY backend ./backend

RUN npm run build --workspace backend

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json

RUN npm ci --omit=dev --workspace backend

COPY --from=builder /app/backend/dist ./backend/dist
COPY backend/db ./backend/db
COPY backend/uploads ./backend/uploads

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "backend"]

