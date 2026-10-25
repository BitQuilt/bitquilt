# The hosted tracker: the reference tracker with the connector mounted beside it, for people who cannot run Quilt.
# docs/DEPLOY.md says how to run it. Everything it keeps lives under /data: the chain, the names, the encrypted keys.
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV QUILT_HOST=0.0.0.0 QUILT_PORT=3977 QUILT_DB=/data/tracker.db QUILT_HOSTED_HOME=/data/hosted
VOLUME /data
EXPOSE 3977
CMD ["pnpm", "--filter", "@bitquilt/hosted", "start"]
