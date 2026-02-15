const express = require('express');
const http = require('http');
const cors = require('cors');
const app = express();
const server = http.createServer(app);

// Enable CORS for all routes (important for Vercel/Render connection)
app.use(cors());

const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Maps peer IDs to socket IDs and back for reliable routing.
const peerToSocket = new Map();
const socketToPeer = new Map();

const PEER_ID_LENGTH = 6;

function createPeerId(socketId) {
    let peerId = socketId.substring(0, PEER_ID_LENGTH);

    // Ensure the generated ID is unique. If not, grow from socketId and fallback to random chars.
    while (peerToSocket.has(peerId)) {
        if (peerId.length < socketId.length) {
            peerId = socketId.substring(0, peerId.length + 1);
        } else {
            peerId = `${peerId}${Math.random().toString(36).slice(2, 3)}`;
        }
    }

    return peerId;
}

function resolveTargetSocketId(rawTargetId) {
    if (!rawTargetId || typeof rawTargetId !== "string") {
        return null;
    }

    const targetId = rawTargetId.trim();
    if (!targetId) {
        return null;
    }

    if (peerToSocket.has(targetId)) {
        return peerToSocket.get(targetId);
    }

    return io.sockets.sockets.has(targetId) ? targetId : null;
}

app.get("/", (req, res) => {
    res.send("🚀 QuickShare Signaling Server is Live!");
});

io.on('connection', (socket) => {
    const peerId = createPeerId(socket.id);
    peerToSocket.set(peerId, socket.id);
    socketToPeer.set(socket.id, peerId);

    // Automatically join a room named after the peerId for private signaling
    socket.join(peerId);

    console.log(`✅ User Connected: ${peerId} (${socket.id})`);
    socket.emit("me", peerId);

    // 2. Private Handshake: User A calls User B
    socket.on("callUser", (data) => {
        const targetSocketId = resolveTargetSocketId(data?.userToCall);

        if (!targetSocketId) {
            socket.emit("userUnavailable", { userToCall: data?.userToCall });
            return;
        }

        io.to(targetSocketId).emit("callUser", {
            signal: data.signalData,
            from: data.from,
            name: data.name
        });
    });

    // 3. Private Handshake: User B answers User A
    socket.on("answerCall", (data) => {
        const targetSocketId = resolveTargetSocketId(data?.to);

        if (!targetSocketId) {
            socket.emit("userUnavailable", { userToCall: data?.to });
            return;
        }

        io.to(targetSocketId).emit("callAccepted", data.signal);
    });

    // 4. Feedback Logger
    socket.on("sendFeedback", (feedback) => {
        console.log("--------------------------------");
        console.log(`📝 FEEDBACK FROM ${peerId}: ${feedback}`);
        console.log("--------------------------------");
    });

    socket.on("disconnect", () => {
        const disconnectedPeerId = socketToPeer.get(socket.id);
        if (disconnectedPeerId) {
            peerToSocket.delete(disconnectedPeerId);
        }
        socketToPeer.delete(socket.id);

        console.log(`❌ User Disconnected: ${disconnectedPeerId || "unknown"} (${socket.id})`);
        socket.broadcast.emit("callEnded");
    });
});

// CRITICAL: Use process.env.PORT for Render deployment
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`))
    .on('error', (err) => {
        console.error('Server failed to start:', err);
    });

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
