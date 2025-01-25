# Backend build stage (using Debian-based image)
FROM node:18-bullseye-slim AS backend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Frontend build stage
FROM node:18-bullseye-slim AS frontend
WORKDIR /app
COPY frontend ./frontend
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN cd frontend && npm install
RUN cd frontend && npm run build

# Production stage
FROM node:18-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend /app .
COPY --from=frontend /app/dist ./public
RUN npm install --production
COPY --from=backend /app/chat.db .
EXPOSE 3001
CMD ["sh", "-c", "npm run init-db && npm start"]