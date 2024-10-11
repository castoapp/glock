# glock

Glock is a Browser/Node.js library that allows you to transport AV stream over UDP to a server via WebRTC.

Initially, we wanted to use Geckos.io for this, but it turned out that this library even does not initialize in the browser. Moreover, this library is more suitable for implementing games, rather than transporting an AV stream. Therefore, we had to write our own solution.

Our solution uses UDP over WebRTC, but also has the ability to send and receive packets via TCP over WebSockets as a fallback.
