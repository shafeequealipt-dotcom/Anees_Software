# Build and run the web app (Next.js standalone output).
FROM node:24-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /src
# Capped so the build stays inside a small VM's RAM+swap instead of getting OOM-killed;
# raise or drop this on a build machine with more memory to spare.
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=768
COPY --from=deps /src/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Kolkata
# OCR for the Telegram bill bot: Tesseract reads photos, poppler reads PDFs (see src/server/telegram/ocr.ts).
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng poppler-utils \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app \
 && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=build --chown=app:app /src/.next/standalone ./
COPY --from=build --chown=app:app /src/.next/static ./.next/static
COPY --from=build --chown=app:app /src/public ./public
COPY --from=build --chown=app:app /src/drizzle ./drizzle
COPY --from=build --chown=app:app /src/assets ./assets
USER app
EXPOSE 3000
CMD ["node", "server.js"]
