FROM node:20-bookworm-slim AS base

WORKDIR /app

FROM base AS development

ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3001

CMD ["npm", "run", "dev"]

FROM base AS build

ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM base AS production-deps

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS production

ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

EXPOSE 3001

CMD ["npm", "run", "start"]


