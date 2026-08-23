# ---- build stage -----------------------------------------------------------
# devDependencies (tailwind, postcss, autoprefixer) are build-time tools, so
# the install here must NOT be --production: without them PostCSS cannot
# resolve `tailwindcss` and index.css compiles to nothing.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# package-lock.json is written by npm 11, but node:20-alpine ships npm 10.8.2,
# and the two disagree about whether to materialise `yaml`, an optional peer of
# postcss-load-config. `npm ci` treats any such disagreement as fatal rather
# than reconciling it, so pin npm to the version that wrote the lockfile.
RUN npm i -g npm@11.6.2 && npm ci
COPY . .
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
# The dev server (`npm start`) serves unminified modules, no compression and no
# cache headers, and keeps an HMR socket open per client. Production serves the
# static build through nginx instead.
FROM nginx:1.27-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Included from several blocks in default.conf; see the file for why.
COPY security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
