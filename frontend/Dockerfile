# ---- build stage -----------------------------------------------------------
# devDependencies (tailwind, postcss, autoprefixer) are build-time tools, so
# the install here must NOT be --production: without them PostCSS cannot
# resolve `tailwindcss` and index.css compiles to nothing.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
# The dev server (`npm start`) serves unminified modules, no compression and no
# cache headers, and keeps an HMR socket open per client. Production serves the
# static build through nginx instead.
FROM nginx:1.27-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
