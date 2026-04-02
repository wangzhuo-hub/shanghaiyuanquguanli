FROM node:20-alpine
WORKDIR /app
COPY ai-proxy.mjs ./
ENV NODE_ENV=production
EXPOSE 3010
CMD ["node", "ai-proxy.mjs"]
