FROM oven/bun:1.3.14

WORKDIR /app/server

COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile

COPY server/ ./

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
