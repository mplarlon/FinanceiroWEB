FROM node:22-alpine AS build
WORKDIR /app
COPY node-app/update-system/center/package.json node-app/update-system/center/package-lock.json ./
RUN npm ci
COPY node-app/update-system/center ./center
COPY node-app/update-system/shared.js ./shared.js
RUN npx vite build --config center/vite.config.js

FROM node:22-alpine
ENV NODE_ENV=production UPDATE_CENTER_HOST=0.0.0.0 UPDATE_CENTER_PORT=8443
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/center ./center
COPY --from=build /app/shared.js ./shared.js
RUN mkdir -p /var/lib/erp-update-center && chown -R node:node /var/lib/erp-update-center /app
USER node
EXPOSE 8443
CMD ["node", "center/server.js"]
