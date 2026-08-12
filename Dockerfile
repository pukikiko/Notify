FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci

COPY frontend/ ./frontend/
RUN npm --prefix frontend run build


FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

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
