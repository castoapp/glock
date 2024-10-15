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

# Install gstreamer
RUN apt-get install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-tools gstreamer1.0-x gstreamer1.0-alsa gstreamer1.0-gl gstreamer1.0-gtk3 gstreamer1.0-qt5 gstreamer1.0-pulseaudio

EXPOSE 8080

CMD ["npm", "run", "start"]
