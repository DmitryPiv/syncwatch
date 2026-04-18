const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Настройки для продакшена
    pingTimeout: 60000,
    pingInterval: 25000
});

const rooms = new Map();

// Раздаём статические файлы
app.use(express.static(__dirname));

// Все запросы направляем на index.html (для поддержки клиентского роутинга)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO логика
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join-room', ({ roomId, userId, userName }) => {
        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                users: [],
                videoState: { 
                    playing: false, 
                    currentTime: 0, 
                    videoId: 'dQw4w9WgXcQ' 
                }
            });
        }
        
        const room = rooms.get(roomId);
        const existingUser = room.users.find(u => u.id === userId);
        
        if (!existingUser) {
            room.users.push({ id: userId, name: userName, socketId: socket.id });
        }
        
        // Отправляем текущее состояние новому пользователю
        socket.emit('sync-state', room.videoState);
        
        // Уведомляем остальных
        socket.to(roomId).emit('user-joined', { 
            userName, 
            userCount: room.users.length 
        });
        
        console.log(`${userName} joined ${roomId}, users: ${room.users.length}`);
    });
    
    socket.on('play', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState = { ...room.videoState, playing: true, currentTime: time };
            socket.to(roomId).emit('play', { time });
        }
    });
    
    socket.on('pause', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState = { ...room.videoState, playing: false, currentTime: time };
            socket.to(roomId).emit('pause', { time });
        }
    });
    
    socket.on('seek', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState.currentTime = time;
            socket.to(roomId).emit('seek', { time });
        }
    });
    
    socket.on('video-change', ({ roomId, videoId }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState.videoId = videoId;
            room.videoState.currentTime = 0;
            socket.to(roomId).emit('video-change', { videoId });
        }
    });
    
    socket.on('chat-message', ({ roomId, userName, message }) => {
        io.to(roomId).emit('chat-message', { userName, message });
    });
    
    socket.on('sync-request', ({ roomId, time, playing }) => {
        const room = rooms.get(roomId);
        if (room && Math.abs(room.videoState.currentTime - time) > 1) {
            socket.emit('sync-state', room.videoState);
        }
    });
    
    socket.on('leave-room', ({ roomId, userId }) => {
        const room = rooms.get(roomId);
        if (room) {
            const userIndex = room.users.findIndex(u => u.id === userId);
            if (userIndex !== -1) {
                const user = room.users[userIndex];
                room.users.splice(userIndex, 1);
                io.to(roomId).emit('user-left', { 
                    userName: user.name, 
                    userCount: room.users.length 
                });
                
                if (room.users.length === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} deleted (empty)`);
                }
            }
        }
        socket.leave(roomId);
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Очистка комнат
        for (let [roomId, room] of rooms.entries()) {
            const userIndex = room.users.findIndex(u => u.socketId === socket.id);
            if (userIndex !== -1) {
                const user = room.users[userIndex];
                room.users.splice(userIndex, 1);
                io.to(roomId).emit('user-left', { 
                    userName: user.name, 
                    userCount: room.users.length 
                });
                if (room.users.length === 0) {
                    rooms.delete(roomId);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Open: http://localhost:${PORT}`);
});