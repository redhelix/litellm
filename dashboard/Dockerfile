FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# .env.production is NOT secret — it only contains the LAN sidecar hostname (docker-001:4001).
# See threat model T-02-01: no keys, no credentials, LAN-only hostname.
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
