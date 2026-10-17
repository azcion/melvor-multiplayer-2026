FROM oven/bun:1.3.14

WORKDIR /app/server

COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile

COPY server/ ./

# Browser Chat reuses the mod's pure tag definitions and existing artwork.
COPY mod/chat-items.mjs /app/mod/chat-items.mjs
COPY mod/assets/multiplayer.svg mod/assets/transfer_bag.svg mod/assets/market.svg mod/assets/crucible.png mod/assets/expedition-nav.png mod/assets/raid-nav.png /app/mod/assets/

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
