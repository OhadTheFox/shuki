# Shuki on any server: docker build -t shuki . && docker run -d -p 8787:8787 -v shuki-data:/data --name shuki shuki
# The first start prints a one-time setup code (docker logs shuki). Phones need HTTPS in front of it.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY worker ./worker
COPY public ./public
COPY migrations ./migrations
COPY server ./server
ENV PORT=8787 DB_PATH=/data/shuki.db NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/node.js"]
