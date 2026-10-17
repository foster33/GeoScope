FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY server ./server
COPY lib ./lib
COPY sources ./sources
COPY watch ./watch
COPY public ./public

ENV PORT=8080 \
    DATA_DIR=/data

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

# the saved-places route answers from the local file, so this probes the
# process without touching any upstream service
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/history > /dev/null || exit 1

CMD ["node", "server.js"]
