# ==========================================
# TEAMSKI - CONTAINER IMAGE
# ==========================================
#
# One image, two processes: docker-compose.yml runs
# it once as the web app and once as the worker.
#
# NEXT_PUBLIC_* values are baked into the browser
# code when the app is built, so they are build
# arguments here - change them and rebuild.
#

FROM node:24-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci


FROM node:24-slim AS build

WORKDIR /app

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_META_PIXEL_ID=

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN npm run build


FROM node:24-slim AS run

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The worker runs TypeScript straight from source,
# so the source comes along with the build.

COPY --from=build --chown=node:node /app ./

RUN mkdir -p agent-files && chown node:node agent-files

USER node

EXPOSE 3000

CMD ["npm", "start"]
