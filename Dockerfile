FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY sources ./sources
COPY watch ./watch
COPY public ./public

ENV PORT=8080 \
    DATA_DIR=/data

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "server.js"]
