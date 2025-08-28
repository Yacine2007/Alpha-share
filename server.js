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
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    server: 'Alpha Share on Render',
    version: '1.0.0',
    connections: activeConnections.size,
    port: PORT
  });
});

// socket.io events
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);
  
  // إرسال حدث اتصال ناجح للعميل
  socket.emit('connection-established', { 
    message: 'Connected to server successfully',
    socketId: socket.id
  });
  
  socket.on('join-room', async (uuid) => {
    console.log('🚪 Join room request for UUID:', uuid);
    
    try {
      // قبول جميع UUIDs دون التحقق من GitHub للاختبار
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
      socket.emit('room-joined', { 
        uuid: uuid, 
        success: true,
        message: 'Successfully joined room'
      });
      
      // إرسال بيانات افتراضية للاختبار
      socket.emit('update-screen', {
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      });
      
      // إرسال إحصائيات نظام افتراضية للاختبار
      socket.emit('system-stats', {
        stats: {
          cpu: 15,
          memory: 45,
          disk: 30,
          network: 2.5
        }
      });
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('room-joined', { 
        uuid: uuid, 
        success: false, 
        error: 'Internal server error' 
      });
    }
  });
  
  socket.on('control-command', (data) => {
    const { uuid, command, parameters } = data;
    console.log(`📨 Control command received: ${command} for UUID: ${uuid}`);
    
    if (activeConnections.has(uuid)) {
      activeConnections.get(uuid).lastActivity = new Date();
      socket.to(uuid).emit('execute-command', { command, parameters });
      
      // إرسال رد للعميل
      socket.emit('command-executed', {
        success: true,
        command: command,
        message: 'Command sent successfully'
      });
    } else {
      socket.emit('command-executed', {
        success: false,
        command: command,
        message: 'UUID not found or not connected'
      });
    }
  });
  
  socket.on('system-stats', (data) => {
    const { uuid, stats } = data;
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('system-stats', { stats });
    }
  });
  
  socket.on('file-list', (data) => {
    const { uuid, files } = data;
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('file-list', { files });
    }
  });
  
  socket.on('request-file', (data) => {
    const { uuid, fileName } = data;
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('send-file', { fileName });
    }
  });
  
  socket.on('upload-file', (data) => {
    const { uuid, fileName, fileData } = data;
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('receive-file', { fileName, fileData });
    }
  });
  
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, reason);
    for (let [uuid, connection] of activeConnections.entries()) {
      if (connection.socketId === socket.id) {
        reservedUUIDs.delete(uuid);
        activeConnections.delete(uuid);
        console.log(`🗑️ Removed UUID ${uuid} from active connections`);
        break;
      }
    }
  });
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// دالة للحفاظ على الاتصالات النشطة
setInterval(() => {
  console.log(`🔄 Active connections: ${activeConnections.size}`);
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health`);
});
