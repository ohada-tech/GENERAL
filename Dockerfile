# AI Production AP — שרת ענן (Render / כל מארח Docker)
# Node 24 (node:sqlite מובנה) + ffmpeg לעריכה האוטומטית.
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build -w web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATA_DIR=/data
EXPOSE 10000
CMD ["npm", "run", "start", "-w", "server"]
