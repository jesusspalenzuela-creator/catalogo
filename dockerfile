# =========================================================
# Dockerfile — API del catálogo
# Node.js + Express + PostgreSQL + Sharp
# =========================================================
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# 1) Dependencias (usa tu package.json existente)
COPY package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force

# 2) Código de la API
COPY server.js ./server.js

# 3) Carpeta de uploads (se montará como volumen persistente en EasyPanel)
RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "server.js"]
