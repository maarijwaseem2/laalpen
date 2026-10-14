FROM node:22-slim
WORKDIR /app
# placeholder so `prisma generate` can read prisma.config.ts at build time; the real URL comes from .env
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 4000
# apply migrations, seed (idempotent), then start
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]
