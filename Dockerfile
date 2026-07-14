# 多阶段构建：server + 三个前端一起打包，生成一体化单容器镜像。
# docker-compose 的「拆分部署」仍由各子目录的 Dockerfile 独立处理。
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
COPY apps/widget ./apps/widget
COPY apps/workstation ./apps/workstation
COPY apps/demo ./apps/demo

# 构建 shared → server → 三个前端（同源一体化部署，无需配置跨域地址）
# build:server 已含 shared；前端复用同一份 shared dist
RUN npm run build:server \
    && npm run build --workspace assistflow-widget \
    && VITE_BASE_PATH=/workstation/ npm run build --workspace assistflow-workstation \
    && npm run build --workspace assistflow-demo

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
# 内置静态站点开关（运行时 -e 覆盖即可，无需重新构建镜像）：
# demo=根路径演示站，widget=/widget 嵌入脚本，workstation=/workstation 客服工作台。
# 只想对外暴露 API 时三个都设 false。
ENV DEMO_ENABLED=true
ENV WIDGET_ENABLED=true
ENV WORKSTATION_ENABLED=true

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
