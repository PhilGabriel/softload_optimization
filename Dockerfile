FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY sync.mjs ./
ENV OUT_FILE=/data/soft-nav-vitals.js
USER node
CMD ["node", "sync.mjs"]
