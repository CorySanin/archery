FROM node:lts-alpine AS base
FROM base AS build-env

WORKDIR /build
RUN apk add --no-cache pnpm
RUN --mount=target=/build/package.json,source=package.json \
    --mount=target=/build/pnpm-lock.yaml,source=pnpm-lock.yaml \
    --mount=target=/build/pnpm-workspace.yaml,source=pnpm-workspace.yaml \
    pnpm install
COPY . .
RUN pnpm run build && \
    pnpm install --prod

FROM base AS deploy

WORKDIR /srv/archery

RUN apk add --no-cache docker-cli
COPY --link --from=build-env /build .

EXPOSE 8080
CMD [ "node", "--experimental-strip-types", "src/index.ts"]