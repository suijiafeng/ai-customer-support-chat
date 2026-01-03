FROM node:22-alpine AS apps-builder

WORKDIR /app

COPY apps/widget/package*.json ./apps/widget/
COPY apps/workstation/package*.json ./apps/workstation/

RUN npm ci --prefix apps/widget \
    && npm ci --prefix apps/workstation

COPY apps/widget ./apps/widget
COPY apps/workstation ./apps/workstation

RUN npm run build --prefix apps/widget \
    && npm run build --prefix apps/workstation

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY server ./server
COPY data ./data
COPY public ./public
COPY --from=apps-builder /app/apps/widget/dist ./apps/widget/dist
COPY --from=apps-builder /app/apps/widget/demo ./apps/widget/demo
COPY --from=apps-builder /app/apps/workstation/dist ./apps/workstation/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'wget -qO- http://127.0.0.1:${PORT:-3001}/api/health || exit 1'

USER node

CMD ["npm", "start"]
