# Stage 1: build
FROM node:22.14.0-alpine3.21 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

# Stage 2: production image
FROM node:22.14.0-alpine3.21 AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Use non-root user included in Alpine node images
USER node

EXPOSE 3001

CMD ["npm", "run", "start"]
