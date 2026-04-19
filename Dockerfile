FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache docker-cli docker-cli-compose bash avahi-tools

FROM base AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# node-pty requires a C++ compiler at install time
RUN apk add --no-cache python3 make g++ linux-headers && npm install --ignore-scripts && npm rebuild node-pty --build-from-source=false

FROM base AS web-deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM base AS server-build
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server ./
COPY tsconfig.json /app/
RUN npm run build

FROM base AS web-build
WORKDIR /app/web
COPY --from=web-deps /app/web/node_modules ./node_modules
COPY web ./
COPY tsconfig.json ../
RUN npm run build

FROM base AS production
WORKDIR /app

COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=web-build /app/web/dist ./web/dist
COPY server/src/services/mdns-supervisor.sh ./server/mdns-supervisor.sh

COPY server/package.json ./server/package.json
COPY package.json ./

RUN mkdir -p data

ARG BUILD_VERSION=dev
ENV BUILD_VERSION=$BUILD_VERSION
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "server/dist/index.js"]