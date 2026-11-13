FROM node:24-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN apt-get update && apt-get install --no-install-recommends -y tini
COPY package.json package-lock.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium
COPY . .
RUN npm run build
RUN npm prune --omit=dev
ENV NODE_ENV=production
ENV SKS_BIND_ADDRESS=0.0.0.0
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["npm", "start"]
