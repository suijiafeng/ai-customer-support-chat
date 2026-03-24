# 独立静态部署：构建 workstation 产物，nginx 托管
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/workstation/package.json ./apps/workstation/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/workstation ./apps/workstation

ARG VITE_API_BASE=""
ARG VITE_BASE_PATH="/"
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_BASE_PATH=$VITE_BASE_PATH

RUN npm run build --workspace @assistflow/shared \
    && npm run build --workspace assistflow-workstation

FROM nginx:alpine

COPY --from=builder /app/apps/workstation/dist /usr/share/nginx/html
COPY apps/workstation/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
