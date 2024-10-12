# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.json ./

RUN yarn

COPY . .

RUN npm run build

# Remove existing node_datachannel
RUN npm uninstall node-datachannel

# Install and build node-datachannel for the current environment
RUN apk add --no-cache python3 make g++ && \
    npm install node-datachannel && \
    npm rebuild node-datachannel

EXPOSE 8080

CMD ["npm", "run", "start"]
