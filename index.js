import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import QRCode from "react-qr-code";
import { Buffer } from "buffer";
import "./App.css";

// Required for simple-peer to handle file buffers in the browser
window.Buffer = window.Buffer || Buffer;

// This URL must match your Render backend exactly
// If running locally (http), assume backend is on port 5000 of the same host.
// If running in production (https), use the Render backend.
const SERVER_URL = window.location.protocol === 'http:'
    ? `http://${window.location.hostname}:5000`
    : 'https://p2p-backend-3vl9.onrender.com';

// FORCE WEBSOCKETS to avoid polling issues
const socket = io.connect(SERVER_URL, {
    transports: ['websocket'],
    reconnectionAttempts: 5,
    timeout: 20000
});

function App() {
    const [me, setMe] = useState("");
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState("");
    const [callerSignal, setCallerSignal] = useState(null);
    const [callAccepted, setCallAccepted] = useState(false);
    const [idToCall, setIdToCall] = useState("");
    const [name, setName] = useState("");
    const [connectionStatus, setConnectionStatus] = useState("Connecting...");

    const [file, setFile] = useState(null);
    const [receivedFile, setReceivedFile] = useState(null);
    const [downloadName, setDownloadName] = useState("");
    const [transferProgress, setProgress] = useState(0);
    const [msg, setMsg] = useState("");
    const [chat, setChat] = useState([]);

    const [theme, setTheme] = useState("dark");
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    const [glitch, setGlitch] = useState(false);

    const connectionRef = useRef();
    const fileChunksRef = useRef([]);
    const fileMetaRef = useRef(null);
    const chatEndRef = useRef(null);

    // Buffer for incoming signals (ICE candidates + Offer)
    const signalBuffer = useRef([]);

    const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

    const triggerGlitch = () => {
        setGlitch(true);
        setTimeout(() => setGlitch(false), 500);
    };

    const submitFeedback = () => {
        if (!feedbackText) return;
        socket.emit("sendFeedback", feedbackText);
        alert("Feedback received! We'll look into it.");
        setFeedbackText("");
        setShowFeedback(false);
    };

    const [gameLogs, setGameLogs] = useState([]);

    const log = (txt) => {
        setGameLogs(prev => [`[${new Date().toLocaleTimeString()}] ${txt}`, ...prev]);
        console.log(txt);
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const autoCallId = params.get("call");
        if (autoCallId) setIdToCall(autoCallId);

        socket.on("connect", () => {
            log(`✅ Connected to Backend (${socket.id})`);
            setConnectionStatus("Awaiting Connection");
        });

        socket.on("connect_error", (err) => {
            log(`❌ Socket Error: ${err.message}`);
            setConnectionStatus("Socket Failure");
        });

        socket.on("disconnect", (reason) => {
            log(`⚠️ Socket Disconnected: ${reason}`);
            setConnectionStatus("Disconnected");
        });

        socket.on("me", (id) => {
            setMe(id);
            log(`🆔 My ID: ${id}`);
        });

        socket.on("callUser", (data) => {
            // Buffer the signal (Offer + ICE Candidates)
            signalBuffer.current.push(data.signal);

            // Trigger "Incoming Call" on standard Offer OR if it's the very first signal (fallback)
            const isOffer = data.signal.type === "offer";
            const isFirstSignal = signalBuffer.current.length === 1;

            if (isOffer || isFirstSignal) {
                log(`📞 Incoming call from ${data.from} (type: ${data.signal.type || 'unknown'})`);
                setReceivingCall(true);
                setCaller(data.from);
                setName(data.name);
            } else {
                log(`🧊 Received ICE Candidate from ${data.from}`);
            }
        });

        socket.on("userUnavailable", (data) => {
            log(`❌ User ${data.userToCall} is offline or ID changed.`);
            alert(`Target user ${data.userToCall} not found. Please rescan QR code.`);
            setConnectionStatus("Peer Not Found");
        });

        return () => {
            socket.off("me");
            socket.off("callUser");
            socket.off("connect");
            socket.off("connect_error");
            socket.off("disconnect");
        };
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chat]);

    // Keep-alive ping to prevent connection drops
    useEffect(() => {
        const interval = setInterval(() => {
            if (connectionRef.current?.connected && !connectionRef.current?.destroyed) {
                try { connectionRef.current.send("ping"); } catch (e) { }
            }
        }, 4000);
        return () => clearInterval(interval);
    }, [callAccepted]);

    const peerConfig = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443?transport=tcp",
                username: "openrelayproject",
                credential: "openrelayproject"
            }
        ]
    };

    // Enable Trickle ICE for faster connections
    const callUser = (id) => {
        log(`Strategy: Calling ${id} (Trickle ICE)...`);
        setConnectionStatus("Calling...");
        // trickle: true allows sending candidates as they are found
        const peer = new Peer({ initiator: true, trickle: true, config: peerConfig });

        peer.on("signal", (data) => {
            log(`📡 Sending Signal (type: ${data.type || "candidate"})`);
            socket.emit("callUser", { userToCall: id, signalData: data, from: me, name: name });
        });

        peer.on("connect", () => {
            log("🤝 P2P Connection Established!");
            setConnectionStatus("Connected");
        });

        peer.on("data", handleDataReceive);

        peer.on("close", () => {
            log("❌ Peer Connection Closed");
            setConnectionStatus("Disconnected");
            triggerGlitch();
        });

        peer.on("error", (err) => {
            log(`🚨 Peer Error: ${err.message || err}`);
            setConnectionStatus("Error");
            triggerGlitch();
        });

        socket.on("callAccepted", (signal) => {
            log("✅ Signal Received from Remote");
            setCallAccepted(true);
            peer.signal(signal);
        });

        connectionRef.current = peer;
    };

    const answerCall = () => {
        log("Strategy: Answering Call (Trickle ICE)...");
        setCallAccepted(true);
        setConnectionStatus("Connecting...");
        const peer = new Peer({ initiator: false, trickle: true, config: peerConfig });

        peer.on("signal", (data) => {
            log(`📡 Sending Answer Signal (type: ${data.type || "candidate"})`);
            // Send answer back to caller
            socket.emit("answerCall", { signal: data, to: caller });
        });

        peer.on("connect", () => {
            log("🤝 P2P Connection Established!");
            setConnectionStatus("Connected");
        });

        peer.on("data", handleDataReceive);

        peer.on("close", () => {
            log("❌ Peer Connection Closed");
            setConnectionStatus("Disconnected");
            triggerGlitch();
        });

        peer.on("error", (err) => {
            log(`🚨 Peer Error: ${err.message || err}`);
            setConnectionStatus("Error");
            triggerGlitch();
        });

        // Process all buffered signals (Offer + Candidates)
        log(`Processing ${signalBuffer.current.length} buffered signals...`);
        signalBuffer.current.forEach(sig => peer.signal(sig));
        signalBuffer.current = []; // Clear buffer

        // Direct future signals to the peer
        socket.off("callUser"); // Stop buffering from useEffect
        socket.on("callUser", (data) => {
            log(`📡 Received Late Signal (type: ${data.signal.type || "candidate"})`);
            peer.signal(data.signal);
        });

        connectionRef.current = peer;
    };

    const handleDataReceive = (data) => {
        let str = "";
        try { str = data.toString(); } catch (e) { str = ""; }
        if (str === "ping") return;

        if (str.startsWith('{"text":')) {
            const payload = JSON.parse(str);
            setChat((prev) => [...prev, { sender: "peer", text: payload.text }]);
            return;
        }
        if (str === "file-end") {
            const blob = new Blob(fileChunksRef.current, { type: fileMetaRef.current?.type });
            setReceivedFile(URL.createObjectURL(blob));
            setDownloadName(fileMetaRef.current?.name || "download");
            setProgress(100);
            fileChunksRef.current = [];
            return;
        }
        if (str.includes('{"meta":')) {
            const parsed = JSON.parse(str);
            if (parsed.meta) { fileMetaRef.current = parsed.meta; return; }
        }
        fileChunksRef.current.push(data);
    };

    const sendText = () => {
        if (!msg || !connectionRef.current) return;
        try {
            connectionRef.current.send(JSON.stringify({ text: msg }));
            setChat((prev) => [...prev, { sender: "me", text: msg }]);
            setMsg("");
        } catch (err) { triggerGlitch(); alert("Connection lost!"); }
    };

    const sendFile = () => {
        if (!file || !connectionRef.current) return;
        connectionRef.current.send(JSON.stringify({ meta: { name: file.name, type: file.type } }));

        const reader = new FileReader();
        reader.onload = () => {
            const buffer = Buffer.from(reader.result);
            const chunkSize = 16 * 1024; // 16KB chunks
            let offset = 0;

            while (offset < buffer.length) {
                connectionRef.current.send(buffer.slice(offset, offset + chunkSize));
                offset += chunkSize;
                setProgress(Math.round((offset / buffer.length) * 100));
            }
            connectionRef.current.send("file-end");
        };
        reader.readAsArrayBuffer(file);
    };

    // Logic to create a link that automatically calls this device ID
    const currentUrl = window.location.href.split('?')[0];
    const magicLink = `${currentUrl}?call=${me}`;

    return (
        <div className="app-wrapper" data-theme={theme}>
            <div className={`container ${glitch ? "glitch-active" : ""}`}>

                {/* TOP ICONS SECTION */}
                <div className="top-nav">
                    <button className="theme-toggle" onClick={() => setShowPrivacy(!showPrivacy)}>
                        <span>🛡️</span>
                    </button>
                    <button className="theme-toggle" onClick={toggleTheme}>
                        <span>{theme === "dark" ? "☀️" : "🌙"}</span>
                    </button>
                </div>

                {/* PRIVACY MODAL */}
                {showPrivacy && (
                    <div className="card privacy-modal">
                        <h3>🔒 Zero-Knowledge</h3>
                        <ul className="privacy-list">
                            <li><strong>Direct P2P:</strong> Files never touch servers.</li>
                            <li><strong>No Database:</strong> We store zero logs.</li>
                            <li><strong>RAM Only:</strong> Data vanishes on exit.</li>
                        </ul>
                        <button className="btn-primary" onClick={() => setShowPrivacy(false)}>Close</button>
                    </div>
                )}

                <div className="header">
                    <h1>⚡ QuickShare</h1>
                    <p>Secure Lab-to-Mobile Transfer</p>
                </div>

                <div className="status-bar" data-status={connectionStatus}>
                    Status: {connectionStatus}
                </div>

                {/* DISCOVERY RADAR SECTION */}
                {!callAccepted && (
                    <div className="card radar-card">
                        <h3>Discovery Mode</h3>
                        <div className="radar-container">
                            <div className="radar-ring"></div>
                            <div className="radar-ring"></div>
                            <div className="radar-ring"></div>
                            <div className="radar-beam"></div>
                            <div className="radar-content">
                                <QRCode
                                    value={magicLink}
                                    size={120}
                                    fgColor={theme === "dark" ? "#1e1b4b" : "#0f172a"}
                                />
                            </div>
                        </div>
                        <div className="device-info">
                            <p>Device ID: <span className="id-text">{me}</span></p>
                            <p className="sub-text">Searching for nearby peers...</p>
                        </div>
                    </div>
                )}

                {!callAccepted && (
                    <div className="card">
                        <h3>Connect to Peer</h3>
                        <input type="text" placeholder="Enter ID..." value={idToCall} onChange={(e) => setIdToCall(e.target.value)} />
                        <button className="btn-primary" onClick={() => callUser(idToCall)}>Connect</button>
                    </div>
                )}

                {receivingCall && !callAccepted && (
                    <div className="card incoming-call">
                        <h3>🔔 Incoming Connection...</h3>
                        <p>From ID: {caller}</p>
                        <button className="btn-primary" onClick={answerCall}>Accept</button>
                    </div>
                )}

                {connectionStatus === "Connected" && (
                    <>
                        <div className="card chat-card">
                            <h3>💬 Chat</h3>
                            <div className="chat-window">
                                {chat.map((c, i) => (
                                    <div key={i} className={`chat-bubble ${c.sender}`}>
                                        <span>{c.text}</span>
                                    </div>
                                ))}
                                <div ref={chatEndRef} />
                            </div>
                            <div className="chat-input-row">
                                <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Type..." />
                                <button className="btn-primary" onClick={sendText}>Send</button>
                            </div>
                        </div>

                        <div className="card transfer-card">
                            <h3>📁 Secure Transfer</h3>
                            <div className="file-upload-wrapper">
                                <input type="file" onChange={(e) => setFile(e.target.files[0])} className="file-input" />
                                <p>{file ? file.name : "Tap to Select File"}</p>
                            </div>

                            <button className="btn-primary" onClick={sendFile} disabled={!file}>
                                {transferProgress > 0 && transferProgress < 100 ? "Transferring..." : "Send Now"}
                            </button>

                            {/* LIQUID PROGRESS UI */}
                            {transferProgress > 0 && (
                                <div className={`liquid-container ${transferProgress === 100 ? "liquid-success" : ""}`}>
                                    <div className="progress-text">
                                        {transferProgress === 100 ? "✓ Complete" : `${transferProgress}%`}
                                    </div>
                                    <div className="liquid-fill" style={{ height: `${transferProgress}%` }}></div>
                                </div>
                            )}

                            {receivedFile && (
                                <a href={receivedFile} download={downloadName} className="btn-download">
                                    Download Received File
                                </a>
                            )}
                        </div>
                    </>
                )}

                <div className="feedback-section">
                    <button className="glitch-btn" onClick={() => setShowFeedback(!showFeedback)}>
                        Report a Glitch
                    </button>
                    {showFeedback && (
                        <div className="card feedback-card">
                            <h3>🐛 Report Issue</h3>
                            <textarea rows={3} placeholder="Describe issue..." value={feedbackText} onChange={e => setFeedbackText(e.target.value)} />
                            <button className="btn-primary" onClick={submitFeedback}>Submit</button>
                        </div>
                    )}
                </div>

            </div>

            {/* DEBUG LOG SECTION */}
            <div className="card log-card">
                <h3>🛠️ Debug Logs</h3>
                <div className="log-window">
                    {gameLogs.map((l, i) => (
                        <div key={i} className="log-entry">{l}</div>
                    ))}
                </div>
            </div>

        </div>
    );
}

export default App;
