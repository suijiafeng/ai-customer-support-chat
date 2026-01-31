# 多阶段构建：workspaces 全量构建 → 运行镜像只带 server 产物与前端 dist
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/widget/package.json ./apps/widget/
COPY apps/workstation/package.json ./apps/workstation/
COPY apps/demo/package.json ./apps/demo/

RUN npm ci

COPY packages ./packages
COPY apps ./apps

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

RUN npm ci --omit=dev --workspace @assistflow/server --include-workspace-root=false \
    && npm cache clean --force

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/data ./apps/server/data
COPY --from=builder /app/apps/widget/dist ./apps/widget/dist
COPY --from=builder /app/apps/workstation/dist ./apps/workstation/dist
COPY --from=builder /app/apps/demo/dist ./apps/demo/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'wget -qO- http://127.0.0.1:${PORT:-3001}/api/health || exit 1'

USER node

CMD ["node", "apps/server/dist/main.js"]
