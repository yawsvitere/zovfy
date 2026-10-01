FROM node:22-alpine AS build
WORKDIR /app
COPY src/Zovfy.Web/package*.json ./
RUN npm ci
COPY src/Zovfy.Web/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY src/Zovfy.Web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80