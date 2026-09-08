FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY app/package.json ./app/package.json
RUN npm ci

FROM dependencies AS build
COPY app ./app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/app/.next/standalone ./
COPY --from=build --chown=node:node /app/app/.next/static ./app/.next/static
USER node
EXPOSE 3000
CMD ["node", "app/server.js"]
