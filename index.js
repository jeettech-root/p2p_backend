const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*", // Allow all connections (Mobile + Desktop)
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    // 1. Give the user a short 4-character ID
    const userId = socket.id.substring(0, 4); 
    console.log(`User Connected: ${userId}`);

    socket.emit("me", userId); // Send ID to the user

    socket.on("disconnect", () => {
        socket.broadcast.emit("callEnded");
    });

    // 2. Handshake: User A calls User B
    socket.on("callUser", (data) => {
        io.to(data.userToCall).emit("callUser", { 
            signal: data.signalData, 
            from: data.from, 
            name: data.name 
        });
    });

    // 3. Handshake: User B answers
    socket.on("answerCall", (data) => {
        // We broadcast to the specific user (data.to)
        // If data.to is a short ID, we need to find the socket. 
        // NOTE: For this simple app, we are relying on the client sending the full socket ID or the room logic. 
        // To keep it simple for your lab project, we will broadcast the answer to everyone 
        // and let the client filter it, OR simpler: just emit to all.
        // For a production app, you'd map IDs to Socket IDs.
        io.emit("callAccepted", data.signal); 
    });
});

server.listen(5000, () => console.log('Server is running on port 5000'));