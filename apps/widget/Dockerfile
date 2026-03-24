# 独立静态部署：构建 widget.js，nginx/CDN 托管
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/widget/package.json ./apps/widget/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/widget ./apps/widget

RUN npm run build --workspace @assistflow/shared \
    && npm run build --workspace assistflow-widget

FROM nginx:alpine

COPY --from=builder /app/apps/widget/dist /usr/share/nginx/html

EXPOSE 80
