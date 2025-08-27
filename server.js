const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

// Render يستخدم المنفذ من متغير البيئة
const PORT = process.env.PORT || 10000;

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const UUID_FILE_URL = 'https://raw.githubusercontent.com/Yacine2007/Alpha-AI-assistant/main/UUID%20QR%20code/UUID.txt';
const activeConnections = new Map();
const reservedUUIDs = new Set();

// middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS للسماح لجميع المصادر
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Alpha Share Server is running on Render',
    status: 'OK',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    server: 'Alpha Share on Render',
    version: '1.0.0',
    connections: activeConnections.size
  });
});

// socket.io events
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);
  
  socket.on('join-room', async (uuid) => {
    console.log('🚪 Join room request for UUID:', uuid);
    
    try {
      const response = await axios.get(UUID_FILE_URL);
      const uuids = response.data.split('\n').map(line => line.trim()).filter(line => line);
      
      if (!uuids.includes(uuid)) {
        socket.emit('room-joined', { 
          uuid: uuid, 
          success: false, 
          error: 'UUID not registered in system' 
        });
        return;
      }
      
      if (reservedUUIDs.has(uuid)) {
        socket.emit('room-joined', { 
          uuid: uuid, 
          success: false, 
          error: 'UUID is already in use' 
        });
        return;
      }
      
      reservedUUIDs.add(uuid);
      socket.join(uuid);
      
      activeConnections.set(uuid, {
        socketId: socket.id,
        connectedAt: new Date(),
        lastActivity: new Date()
      });
      
      console.log(`✅ Socket ${socket.id} joined room ${uuid}`);
      socket.emit('room-joined', { uuid: uuid, success: true });
      
    } catch (error) {
      console.error('Error verifying UUID:', error);
      socket.emit('room-joined', { 
        uuid: uuid, 
        success: false, 
        error: 'Error verifying UUID' 
      });
    }
  });
  
  // باقي events تبقى كما هي
  socket.on('control-command', (data) => {
    const { uuid, command, parameters } = data;
    if (activeConnections.has(uuid)) {
      activeConnections.get(uuid).lastActivity = new Date();
      socket.to(uuid).emit('execute-command', { command, parameters });
    }
  });
  
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, reason);
    for (let [uuid, connection] of activeConnections.entries()) {
      if (connection.socketId === socket.id) {
        reservedUUIDs.delete(uuid);
        activeConnections.delete(uuid);
        break;
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health`);
});
