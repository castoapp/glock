# Glock

Glock is a comprehensive solution consisting of a client library and a server application designed to transmit AV stream from a browser to any output destination using FFmpeg (for example, YouTube via RTMP).

## Features

- Client library (compatible with browsers and Electron)
- Node.js server application deployable with Docker Compose
- Stream transmission using WebRTC (UDP) for low latency
- Fallback option using WebSocket (TCP) **TODO**
- Direct transmission of AV stream to any FFmpeg-supported output
- Configurable video encoding parameters **TODO**
- Automatic buffer size adjustment for optimal performance

## Components

### Client (Browser/Electron)

The client library is a lightweight JS library written in TypeScript that captures and transmits AV stream from websites or Electron applications.

### Server (Node.js)

The server application, written in TypeScript for Node.js, receives the browser stream and uses FFmpeg to encode and output it to the desired destination.

## Installation

### Client

To use the client library in your project, install it via npm:

```bash
npm install glock-client
```

Then you can import it in your project:

```typescript
import Client from "glock-client";

// Capture AV stream from a video element
const stream = video.captureStream(30);

// Replace with your actual WebSocket server URL and auth key
client = new Client("ws://127.0.0.1:8080", stream, {
  debug: false,
  authKey: "your-secret-auth-key",
});

// ...

client.connect();
```

### Server

To use the server application, clone the repository and run it using Docker Compose:

```bash
git clone https://github.com/castoapp/glock.git
cd glock/server
AUTH_KEY=<your-secret-auth-key> docker compose up
```

## Documentation

See the [wiki](https://github.com/castoapp/glock/wiki) for more detailed documentation.

## License

This project is licensed under the GNU GPLv2 license. See the [LICENSE](LICENSE) file for details.
