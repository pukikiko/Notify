FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci

COPY frontend/ ./frontend/
RUN npm --prefix frontend run build


FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && YTDLP_ARCH=$([ "$TARGETARCH" = arm64 ] && echo yt-dlp_linux_aarch64 || echo yt-dlp_linux) \
  && DENO_ARCH=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) \
  && curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ARCH}" -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}-unknown-linux-gnu.zip" -o /tmp/deno.zip \
  && unzip -o /tmp/deno.zip -d /usr/local/bin \
  && rm /tmp/deno.zip

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

COPY backend/ ./backend/
COPY --from=build /app/frontend/dist ./frontend/dist

ENV PORT=4000
ENV DATA_DIR=/data
ENV NODE_ENV=production

VOLUME /data

EXPOSE 4000

CMD ["node", "backend/src/index.js"]
