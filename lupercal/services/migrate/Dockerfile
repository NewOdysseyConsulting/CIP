FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY typescript/packages/cip/package.json typescript/packages/cip/package.json
COPY lupercal/romulus/package.json lupercal/romulus/package.json
COPY lupercal/remus/package.json lupercal/remus/package.json
COPY lupercal/services/api/package.json lupercal/services/api/package.json
COPY lupercal/services/migrate/package.json lupercal/services/migrate/package.json

RUN npm ci

COPY . .

RUN npm run build --workspace @new-odyssey/cip \
  && npm run build --workspace @new-odyssey/romulus \
  && npm run build --workspace @new-odyssey/lupercal-api \
  && npm run build --workspace @new-odyssey/lupercal-migrate

FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/typescript/packages/cip/package.json ./typescript/packages/cip/package.json
COPY --from=build /app/typescript/packages/cip/dist ./typescript/packages/cip/dist
COPY --from=build /app/lupercal/romulus/package.json ./lupercal/romulus/package.json
COPY --from=build /app/lupercal/romulus/dist ./lupercal/romulus/dist
COPY --from=build /app/lupercal/services/api/package.json ./lupercal/services/api/package.json
COPY --from=build /app/lupercal/services/api/dist ./lupercal/services/api/dist
COPY --from=build /app/lupercal/services/migrate/package.json ./lupercal/services/migrate/package.json
COPY --from=build /app/lupercal/services/migrate/dist ./lupercal/services/migrate/dist

CMD ["node", "lupercal/services/migrate/dist/src/index.js"]
