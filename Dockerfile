FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV CHROME_PATH=/usr/bin/chromium

# Chromium 用于截图出图，Noto CJK 用于中文字体
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk fonts-noto-cjk-extra ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

EXPOSE 8080
CMD ["node", "server.mjs"]
