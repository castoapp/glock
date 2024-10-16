<p align="center">
  <p align="center">
   <img width="140" height="140" src="casto.png" alt="Icon">
  </p>
  <h1 align="center">
    <b>Glock</b>
  </h1>
  <p align="center">
    Glock is a comprehensive solution consisting of a client library and a server application designed to transmit AV stream from a browser to any output destination using FFmpeg (for example, YouTube via RTMP).
    <br />
    <a href="https://casto.app">
      <b>casto.app</b>
    </a> | <a href="https://glock.casto.app/"><b>documentation</b></a>
    <br />
  </p>
</p>

> **Note:** Glock is currently in active development. Some features may be incomplete or subject to change. Use with caution in production environments.

## Features

- Client library (compatible with browsers and Electron)
- Node.js server application deployable with Docker Compose
- Works with **FFmpeg** and **GStreamer** _(experimental)_
- Stream transmission using WebRTC (UDP) for low latency
- Fallback option using WebSocket (TCP) **TODO**
- Direct transmission of AV stream to any FFmpeg-supported or GStreamer-supported output
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
npm install glockio
```

Then you can import it in your project:

```typescript
import Client from "glockio";

// Capture AV stream from a video element
const stream = video.captureStream(30);

// Replace with your actual WebSocket server URL and auth key
client = new Client("ws://127.0.0.1:8080", stream, {
  debug: false,
  authKey: "your-secret-auth-key",
  /// ... see other options in the docs
});

// Connect to the server
client.connect().then(() => {
  // Start streaming to the destination
  client.start({
    destination: {
        type: "file",
        path: "video.mp4",
    },
    processor: "ffmpeg", // or "gstreamer",
    // ... see other options in the docs
  });
});
```

### Server

To use the server application, clone the repository and run it using Docker Compose:

```bash
git clone https://github.com/castoapp/glock.git
cd glock/server
AUTH_KEY=<your-secret-auth-key> docker compose up
```

## Documentation

See the [docs](https://glock.casto.app/) for more detailed documentation.

## License

This project is licensed under the GNU GPLv2 license. See the [LICENSE](LICENSE) file for details.
