FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY typescript/packages/cip/package.json typescript/packages/cip/package.json
COPY typescript/services/control-plane-api/package.json typescript/services/control-plane-api/package.json

RUN npm ci

COPY . .

RUN npm run build --workspace @new-odyssey/cip \
  && npm run build --workspace @new-odyssey/cip-control-plane-api

FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/typescript/packages/cip/package.json ./typescript/packages/cip/package.json
COPY --from=build /app/typescript/packages/cip/dist ./typescript/packages/cip/dist
COPY --from=build /app/typescript/services/control-plane-api/package.json ./typescript/services/control-plane-api/package.json
COPY --from=build /app/typescript/services/control-plane-api/dist ./typescript/services/control-plane-api/dist

EXPOSE 8080

CMD ["node", "typescript/services/control-plane-api/dist/src/server.js"]
