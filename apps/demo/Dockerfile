# 独立静态部署（可选）：构建 widget 嵌入演示站，nginx 托管
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/demo/package.json ./apps/demo/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/demo ./apps/demo

ARG VITE_WIDGET_SRC=""
ARG VITE_API_BASE=""
ARG VITE_WORKSTATION_URL=""
ENV VITE_WIDGET_SRC=$VITE_WIDGET_SRC
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WORKSTATION_URL=$VITE_WORKSTATION_URL

RUN npm run build --workspace @assistflow/shared \
    && npm run build --workspace assistflow-demo

FROM nginx:alpine

COPY --from=builder /app/apps/demo/dist /usr/share/nginx/html
COPY apps/demo/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
