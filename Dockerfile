# 多阶段构建：只构建 server（+ 其依赖的 shared 包）→ 运行镜像是纯 API 服务。
# widget/workstation/demo 各自独立静态部署，不在这个镜像里（见 README「拆分部署」）。
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/widget/package.json ./apps/widget/
COPY apps/workstation/package.json ./apps/workstation/
COPY apps/demo/package.json ./apps/demo/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

RUN npm run build:server

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

EXPOSE 3001

# SQLite 持久化：库文件写到独立可写卷 /data（与只读种子数据 apps/server/data 分开）。
# 挂载该卷才能跨容器重建/重新部署保留数据；未配 DATABASE_URL 时默认走 SQLite。
ENV SQLITE_PATH=/data/assistflow.db
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# 仅用于本地/自托管 docker run；Render 走 render.yaml 的 healthCheckPath
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'wget -qO- http://127.0.0.1:${PORT:-3001}/api/health || exit 1'

USER node

# --experimental-sqlite 让内置 node:sqlite 生效（Node 22）；否则会降级为纯内存
CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "apps/server/dist/main.js"]
