FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY public ./public
ENV PORT=3000 ORBIT_DATA=/data NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 3000
CMD ["node", "server/server.js"]
