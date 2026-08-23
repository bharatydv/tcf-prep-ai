# ---- build stage -----------------------------------------------------------
# devDependencies (tailwind, postcss, autoprefixer) are build-time tools, so
# the install here must NOT be --production: without them PostCSS cannot
# resolve `tailwindcss` and index.css compiles to nothing.
# Debian rather than alpine, on purpose. react-snap drives the Chromium that
# puppeteer downloads during `npm ci`, and that binary is glibc-linked: on
# alpine's musl it cannot start, so the prerender step failed and fell back to
# a client-only build. Pointing puppeteer at alpine's own chromium package
# instead does not work either — this puppeteer is from 2019 and speaks an
# older DevTools protocol than a current Chromium answers.
#
# Only the BUILD stage changes. The runtime stage below is still nginx:alpine,
# so the published image is the same size it always was.
FROM node:20-bookworm-slim AS build
WORKDIR /app

# What that downloaded Chromium needs in order to start headless.
# Puppeteer's own documented dependency set for Debian, in full. The
# abbreviated list used before was missing libgtk-3-0, libXss and the gdk/pango
# pair, and the bundled Chromium will not start without them - it exits with a
# "error while loading shared libraries" that react-snap reports only as a
# failed browser launch.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates fonts-liberation fonts-noto-color-emoji \
        libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
        libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
        libgdk-pixbuf-2.0-0 libglib2.0-0 libgtk-3-0 \
        libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
        libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
        libxext6 libxfixes3 libxi6 libxkbcommon0 libxrandr2 libxrender1 \
        libxshmfence1 libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# package-lock.json is written by npm 11, but the node:20 images ship npm 10.x,
# and the two disagree about whether to materialise `yaml`, an optional peer of
# postcss-load-config. `npm ci` treats any such disagreement as fatal rather
# than reconciling it, so pin npm to the version that wrote the lockfile.
RUN npm i -g npm@11.6.2 && npm ci

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
#
# To check a deploy actually prerendered:
#   curl -s https://prepfrancais.com/ | grep -c 'id="root"><div'
# A prerendered homepage has markup immediately inside #root; a client-only
# build has <div id="root"></div> and nothing else.
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

# State the outcome in one line, so `docker compose build` cannot finish
# ambiguously. A prerendered index.html has markup immediately inside #root;
# a client-only build has <div id="root"></div> and nothing else.
RUN if grep -q '<div id="root"><div' build/index.html; then \
        echo "PRERENDER OK - index.html is $(stat -c%s build/index.html) bytes with real markup"; \
        echo "PRERENDER OK - $(find build -name index.html | wc -l) route(s) written"; \
    else \
        echo "PRERENDER MISSING - index.html is $(stat -c%s build/index.html) bytes, #root is empty"; \
        echo "PRERENDER MISSING - crawlers without JavaScript will see nothing"; \
    fi

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
