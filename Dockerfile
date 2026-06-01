FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install

FROM deps AS build
COPY . .
RUN npm run build

FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/personas ./personas
COPY --from=build /app/knowledge ./knowledge
COPY package.json ./
CMD ["npm", "start"]
