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

# react-snap drives a real browser to render each public route to static HTML.
# The Chromium puppeteer downloads at install time is glibc-linked and cannot
# run on alpine's musl, so use the distro one and tell puppeteer where it is.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser

COPY . .

# Prerendering, with a fallback to the plain build.
#
# Without this the image shipped an empty shell that only fills in once
# JavaScript runs: Google renders it slowly and unreliably, and most AI
# crawlers do not render at all — so every guide, blog post and exam topic
# written to be quoted was invisible to them. robots.txt has been claiming
# these pages are prerendered for some time; this is what makes that true.
#
# The fallback exists because a headless browser in a build container is the
# most fragile step in this Dockerfile, and a failed prerender must not mean a
# failed deploy. It is loud on purpose: a silent fallback would leave the image
# looking prerendered when it is not, which is exactly the state this fixes.
RUN npm run build:prerender \
    || (echo "" \
        && echo "############################################################" \
        && echo "# PRERENDER FAILED - falling back to a client-only build.  #" \
        && echo "# The site will work, but public pages ship an empty shell #" \
        && echo "# and SEO/AEO crawling is degraded. Fix before relying on  #" \
        && echo "# organic search. See frontend/Dockerfile.                 #" \
        && echo "############################################################" \
        && echo "" \
        && rm -rf build \
        && npm run build)

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
