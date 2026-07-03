FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY src ./src
COPY public ./public
EXPOSE 3000
CMD ["node", "src/server.js"]
