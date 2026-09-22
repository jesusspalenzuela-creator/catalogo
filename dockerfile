# =========================================================
# Dockerfile — API del catálogo
# Node.js + Express + PostgreSQL + Sharp
# =========================================================
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# 1) Dependencias
COPY package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force

# 2) Código de la API
COPY serverjs.js ./serverjs.js
COPY admin.html ./admin.html
COPY admin.js ./admin.js

# 3) Carpeta de uploads (volumen persistente en EasyPanel)
RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "serverjs.js"]
