FROM node:lts-alpine AS base
FROM base AS build-env

WORKDIR /build
COPY ./package*json ./
RUN npm ci
COPY . .
RUN npm run build && \
    npm exec tsc && \
    npm ci --only=production --omit=dev

FROM base AS deploy

WORKDIR /srv/archery

RUN apk add --no-cache docker-cli
COPY --from=build-env /build .

EXPOSE 8080
CMD [ "node", "--experimental-strip-types", "src/index.ts"]