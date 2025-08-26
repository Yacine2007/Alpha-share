const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const UUID_FILE_URL = 'https://raw.githubusercontent.com/Yacine2007/Alpha-AI-assistant/main/UUID%20QR%20code/UUID.txt';

// تخزين للاتصالات النشطة
const activeConnections = new Map();
const reservedUUIDs = new Set();

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// مسار الرئيسي
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// مسار لإنشاء اتصال جديد (لجهاز الكمبيوتر)
app.post('/api/register', async (req, res) => {
  try {
    const { uuid } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID is required' });
    }
    
    // التحقق من أن UUID موجود في الملف على GitHub
    const response = await axios.get(UUID_FILE_URL);
    const uuids = response.data.split('\n').map(line => line.trim()).filter(line => line);
    
    if (!uuids.includes(uuid)) {
      return res.status(404).json({ error: 'UUID not found in the allowed list' });
    }
    
    // التحقق من أن UUID غير مستخدم بالفعل
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

// مسار لإلغاء حجز UUID (لجهاز الكمبيوتر)
app.post('/api/unregister', (req, res) => {
  const { uuid } = req.body;
  
  if (uuid && reservedUUIDs.has(uuid)) {
    reservedUUIDs.delete(uuid);
    
    // إغلاق أي اتصالات نشطة لهذا UUID
    if (activeConnections.has(uuid)) {
      const room = io.sockets.adapter.rooms.get(uuid);
      if (room) {
        room.forEach(socketId => {
          io.to(socketId).disconnectSockets(true);
        });
      }
      activeConnections.delete(uuid);
    }
    
    res.json({ success: true, message: 'UUID unregistered successfully' });
  } else {
    res.status(404).json({ error: 'UUID not found' });
  }
});

// مسار للتحقق من حالة الاتصال (للهاتف)
app.get('/api/connection-status/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  if (activeConnections.has(uuid)) {
    res.json({ connected: true, message: 'Device is connected' });
  } else {
    res.json({ connected: false, message: 'No active connection' });
  }
});

// التعامل مع اتصالات Socket.io
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // انضمام إلى غرفة محددة بناءً على UUID
  socket.on('join-room', (uuid) => {
    if (reservedUUIDs.has(uuid)) {
      socket.join(uuid);
      activeConnections.set(uuid, {
        phoneSocket: socket.id,
        connectedAt: new Date()
      });
      console.log(`Socket ${socket.id} joined room ${uuid}`);
      
      // إعلام جميع الأجهزة في الغرفة بالاتصال الجديد
      socket.to(uuid).emit('phone-connected', { socketId: socket.id });
      socket.emit('room-joined', { uuid, success: true });
    } else {
      socket.emit('room-joined', { uuid, success: false, error: 'UUID not registered' });
    }
  });
  
  // إرسال أوامر التحكم إلى الكمبيوتر
  socket.on('control-command', (data) => {
    const { uuid, command, parameters } = data;
    
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('execute-command', { command, parameters });
      console.log(`Command sent to room ${uuid}: ${command}`);
    }
  });
  
  // إرسال بيانات الشاشة من الكمبيوتر إلى الهاتف
  socket.on('screen-data', (data) => {
    const { uuid, imageData } = data;
    
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('update-screen', { imageData });
    }
  });
  
  // إرسال ملف من الهاتف إلى الكمبيوتر
  socket.on('upload-file', (data) => {
    const { uuid, fileName, fileData } = data;
    
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('receive-file', { fileName, fileData });
    }
  });
  
  // طلب ملف من الكمبيوتر إلى الهاتف
  socket.on('request-file', (data) => {
    const { uuid, fileName } = data;
    
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('send-file', { fileName });
    }
  });
  
  // إدارة إعدادات النظام
  socket.on('system-settings', (data) => {
    const { uuid, settings } = data;
    
    if (activeConnections.has(uuid)) {
      socket.to(uuid).emit('apply-settings', { settings });
    }
  });
  
  // قطع الاتصال
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // البحث عن UUID المرتبط بهذا الاتصال وإزالته
    for (let [uuid, connection] of activeConnections.entries()) {
      if (connection.phoneSocket === socket.id) {
        activeConnections.delete(uuid);
        console.log(`Removed connection for UUID: ${uuid}`);
        break;
      }
    }
  });
});

// بدء الخادم
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});