FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts types.ts ./
COPY scripts ./scripts
COPY services ./services
COPY config ./config

EXPOSE 8787

CMD ["npx", "tsx", "scripts/integration-gateway.ts"]
