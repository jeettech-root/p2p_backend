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

// A simple map to link short IDs to full Socket IDs
const usersMap = new Map();

app.get("/", (req, res) => {
    res.send("🚀 QuickShare Signaling Server is Live!");
});

io.on('connection', (socket) => {
    // 1. Generate a short 4-character ID for the user
    const shortId = socket.id.substring(0, 4);
    usersMap.set(shortId, socket.id);
    
    // Automatically join a room named after the shortId for private signaling
    socket.join(shortId);
    
    console.log(`✅ User Connected: ${shortId}`);
    socket.emit("me", shortId);

    // 2. Private Handshake: User A calls User B
    socket.on("callUser", (data) => {
        // Send signal ONLY to the target short ID's room
        io.to(data.userToCall).emit("callUser", { 
            signal: data.signalData, 
            from: data.from, 
            name: data.name 
        });
    });

    // 3. Private Handshake: User B answers User A
    socket.on("answerCall", (data) => {
        // Use .to() to send the signal PRIVATELY to the caller
        io.to(data.to).emit("callAccepted", data.signal); 
    });

    // 4. Feedback Logger
    socket.on("sendFeedback", (feedback) => {
        console.log("--------------------------------");
        console.log(`📝 FEEDBACK FROM ${shortId}: ${feedback}`);
        console.log("--------------------------------");
    });

    socket.on("disconnect", () => {
        usersMap.delete(shortId);
        console.log(`❌ User Disconnected: ${shortId}`);
        socket.broadcast.emit("callEnded");
    });
});

// CRITICAL: Use process.env.PORT for Render deployment
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
