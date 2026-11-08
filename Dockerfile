# The hosted tracker: the reference tracker with the connector mounted beside it, for people who cannot run Quilt, run
# as one node with the roles admit and host, as deploy/docker-compose.yml runs the public door; each service the compose
# file builds from this image names its own command. docs/DEPLOY.md says how to run it. Everything it keeps lives under
# /data: the chain, the names, the encrypted keys.
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
# The directory window is built from its sources here, as every check and build builds it (window.generated.ts is not committed).
RUN pnpm install --frozen-lockfile && node scripts/build-window.mjs
ENV QUILT_HOST=0.0.0.0 QUILT_PORT=3977 QUILT_DB=/data/tracker.db QUILT_HOSTED_HOME=/data/hosted QUILT_HOME=/data QUILT_ROLES=admit,host
VOLUME /data
EXPOSE 3977
CMD ["pnpm", "--filter", "@bitquilt/node", "start"]
