FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache vips
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN apk add --no-cache python3 make g++ vips-dev \
  && npm install --omit=dev \
  && apk del python3 make g++ vips-dev
COPY --from=build /app/dist ./dist
COPY src/schema.sql ./dist/schema.sql
CMD ["node", "dist/index.js"]
