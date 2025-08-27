const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// استخدام المنفذ من متغير البيئة أو 10000 افتراضيًا
const PORT = process.env.PORT || 10000;
const UUID_FILE_URL = 'https://raw.githubusercontent.com/Yacine2007/Alpha-AI-assistant/main/UUID%20QR%20code/UUID.txt';

const activeConnections = new Map();
const reservedUUIDs = new Set();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware للسماح بـ CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Alpha Share Server is running',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    port: PORT
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    server: 'Alpha Share',
    version: '1.0.0',
    connections: activeConnections.size,
    port: PORT
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const { uuid } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID is required' });
    }
    
    // جلب قائمة UUIDs من GitHub
    const response = await axios.get(UUID_FILE_URL);
    const uuids = response.data.split('\n').map(line => line.trim()).filter(line => line);
    
    if (!uuids.includes(uuid)) {
      return res.status(404).json({ error: 'UUID not found in the allowed list' });
    }
    
    if (reservedUUIDs.has(uuid)) {
      return res.status(409).json({ error: 'UUID is already in use' });
    }
    
    // حجز UUID
    reservedUUIDs.add(uuid);
    
    // إنشاء QR code
    const qrCodeData = await QRCode.toDataURL(uuid);
    
    res.json({ 
      success: true, 
      message: 'UUID registered successfully',
      qrCode: qrCodeData
    });
  } catch (error) {
    console.error('Error in /api/register:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/unregister', (req, res) => {
  const { uuid } = req.body;
  
  if (uuid && reservedUUIDs.has(uuid)) {
    reservedUUIDs.delete(uuid);
    
    // إغلاق أي اتصالات نشطة لهذا UUID
    if (activeConnections.has(uuid)) {
      const room = io.sockets.adapter.rooms.get(uuid);
      if (room) {
        for (let socketId of room) {
          io.to(socketId).disconnectSockets(true);
        }
      }
      activeConnections.delete(uuid);
    }
    
    res.json({ success: true, message: 'UUID unregistered successfully' });
  } else {
    res.status(404).json({ error: 'UUID not found' });
  }
});

app.get('/api/connection-status/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  if (activeConnections.has(uuuid)) {
    const connection = activeConnections.get(uuid);
    res.json({ 
      connected: true, 
      message: 'Device is connected',
      connectedAt: connection.connectedAt,
      lastActivity: connection.lastActivity
    });
  } else {
    res.json({ connected: false, message: 'No active connection' });
  }
});

app.get('/api/uuid-list', async (req, res) => {
  try {
    const response = await axios.get(UUID_FILE_URL);
    const uuids = response.data.split('\n').map(line => line.trim()).filter(line => line);
    
    res.json({
      success: true,
      uuids: uuids,
      reservedUUIDs: Array.from(reservedUUIDs),
      activeConnections: Array.from(activeConnections.keys())
    });
  } catch (error) {
    console.error('Error getting UUID list:', error);
    res.status(500).json({ error: 'Failed to get UUID list' });
  }
});

// معالجة اتصالات Socket.io
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);
  
  socket.on('join-room', async (uuid) => {
    console.log('🚪 Join room request for UUID:', uuid);
    
    try {
      // التحقق من أن UUID موجود في القائمة على GitHub
      const response = await axios.get(UUID_FILE_URL);
      const uuids = response.data.split('\n').map(line => line.trim()).filter(line => line);
      
      if (!uuids.includes(uuid)) {
        console.log(`❌ UUID not found in GitHub list: ${uuid}`);
        socket.emit('room-joined', { 
          uuid: uuid, 
          success: false, 
          error: 'UUID not registered in system' 
        });
        return;
      }
      
      if (reservedUUIDs.has(uuid)) {
        console.log(`❌ UUID already in use: ${uuid}`);
        socket.emit('room-joined', { 
          uuid: uuid, 
          success: false, 
          error: 'UUID is already in use by another device' 
        });
        return;
      }
      
      // حجز UUID وإضافة الاتصال
      reservedUUIDs.add(uuid);
      socket.join(uuid);
      
      activeConnections.set(uuid, {
        phoneSocket: socket.id,
        connectedAt: new Date(),
        lastActivity: new Date()
      });
      
      console.log(`✅ Socket ${socket.id} joined room ${uuid}`);
      socket.emit('room-joined', { uuid: uuid, success: true });
      
      // إرسال تأكيد الاتصال للكمبيوتر
      socket.to(uuid).emit('phone-connected', { 
        socketId: socket.id,
        connectedAt: new Date()
      });
      
    } catch (error) {
      console.error('Error verifying UUID:', error);
      socket.emit('room-joined', { 
        uuid: uuid, 
        success: false, 
        error: 'Error verifying UUID' 
      });
    }
  });
  
  socket.on('control-command', (data) => {
    const { uuid, command, parameters } = data;
    console.log(`📨 Command received for ${uuid}: ${command}`);
    
    if (activeConnections.has(uuid)) {
      // تحديث وقت النشاط الأخير
      activeConnections.get(uuid).lastActivity = new Date();
      
      // إرسال الأمر إلى الكمبيوتر
      socket.to(uuid).emit('execute-command', { command, parameters });
    } else {
      socket.emit('command-error', { error: 'No active connection for this UUID' });
    }
  });
  
  socket.on('system-stats', (data) => {
    const { uuid, stats } = data;
    
    if (activeConnections.has(uuid)) {
      activeConnections.get(uuid).lastActivity = new Date();
      socket.to(uuid).emit('update-stats', { stats });
    }
  });
  
  socket.on('request-file', (data) => {
    const { uuid, fileName } = data;
    
    if (activeConnections.has(uuid)) {
      activeConnections.get(uuid).lastActivity = new Date();
      socket.to(uuid).emit('send-file', { fileName });
    }
  });
  
  socket.on('upload-file', (data) => {
    const { uuid, fileName, fileData } = data;
    
    if (activeConnections.has(uuid)) {
      activeConnections.get(uuid).lastActivity = new Date();
      socket.to(uuid).emit('receive-file', { fileName, fileData });
    }
  });
  
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, reason);
    
    // البحث عن UUID المرتبط بهذا الاتصال وإزالته
    for (let [uuid, connection] of activeConnections.entries()) {
      if (connection.phoneSocket === socket.id) {
        reservedUUIDs.delete(uuid);
        activeConnections.delete(uuid);
        console.log(`🗑️ Removed connection for UUID: ${uuid}`);
        break;
      }
    }
  });
});

// تنظيف الاتصالات غير النشطة كل 5 دقائق
setInterval(() => {
  const now = new Date();
  const inactiveTime = 5 * 60 * 1000; // 5 دقائق
  
  for (let [uuid, connection] of activeConnections.entries()) {
    if (now - connection.lastActivity > inactiveTime) {
      console.log(`🕒 Removing inactive connection: ${uuid}`);
      reservedUUIDs.delete(uuid);
      activeConnections.delete(uuid);
      
      // فصل جميع المقابس في الغرفة
      const room = io.sockets.adapter.rooms.get(uuid);
      if (room) {
        for (let socketId of room) {
          io.to(socketId).disconnectSockets(true);
        }
      }
    }
  }
}, 5 * 60 * 1000);

// بدء الخادم
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 API status: http://localhost:${PORT}/`);
  console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
});

// معالجة الأخطاء غير الملتقطة
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
