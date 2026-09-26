FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    BUILDINGS_FILE=config/buildings.itmo.json

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server
COPY --chown=node:node bot ./bot
COPY --chown=node:node config/buildings.itmo.json ./config/buildings.itmo.json
COPY --chown=node:node index.html styles.css demo.css pilot.css pilot.js bridge.js demo.html app.js model.js ./
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
