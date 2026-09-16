FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY proto ./proto
COPY server.js ./
EXPOSE 50051
CMD ["node", "server.js"]
