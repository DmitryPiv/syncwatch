const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket']
});

app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранилище комнат
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('✅ Connected:', socket.id);
    
    socket.on('join-room', ({ roomId, userId, userName }) => {
        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                users: [],
                currentVideoId: 'dQw4w9WgXcQ',
                currentTime: 0,
                isPlaying: false,
                lastUpdate: Date.now()
            });
        }
        
        const room = rooms.get(roomId);
        const existingUser = room.users.find(u => u.id === userId);
        
        if (!existingUser) {
            room.users.push({ id: userId, name: userName, socketId: socket.id });
        }
        
        // Отправляем текущее состояние ТОЛЬКО новому пользователю
        socket.emit('room-state', {
            videoId: room.currentVideoId,
            currentTime: room.currentTime,
            isPlaying: room.isPlaying
        });
        
        // Уведомляем остальных о новом пользователе
        socket.to(roomId).emit('user-joined', { 
            userName, 
            userCount: room.users.length 
        });
        
        console.log(`${userName} joined ${roomId}, users: ${room.users.length}`);
    });
    
    // Обработка смены видео
    socket.on('change-video', ({ roomId, videoId }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.currentVideoId = videoId;
            room.currentTime = 0;
            room.isPlaying = false;
            room.lastUpdate = Date.now();
            
            // Рассылаем всем КРОМЕ отправителя
            socket.to(roomId).emit('video-changed', { videoId });
            console.log(`Video changed in ${roomId} to ${videoId}`);
        }
    });
    
    // Обработка play (без принудительного seek)
    socket.on('play-video', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.isPlaying = true;
            room.currentTime = time;
            room.lastUpdate = Date.now();
            
            // Просто уведомляем о воспроизведении, без seek
            socket.to(roomId).emit('video-play', { time });
            console.log(`Play in ${roomId} at ${time}s`);
        }
    });
    
    // Обработка pause
    socket.on('pause-video', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.isPlaying = false;
            room.currentTime = time;
            room.lastUpdate = Date.now();
            
            socket.to(roomId).emit('video-pause', { time });
            console.log(`Pause in ${roomId} at ${time}s`);
        }
    });
    
    // Обработка seek (перемотка)
    socket.on('seek-video', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.currentTime = time;
            room.lastUpdate = Date.now();
            
            socket.to(roomId).emit('video-seek', { time });
            console.log(`Seek in ${roomId} to ${time}s`);
        }
    });
    
    // Запрос синхронизации от клиента
    socket.on('request-sync', ({ roomId, clientTime, isPlaying }) => {
        const room = rooms.get(roomId);
        if (room) {
            // Отправляем текущее состояние только если расхождение большое
            const diff = Math.abs(room.currentTime - clientTime);
            if (diff > 3) {
                socket.emit('sync-response', {
                    time: room.currentTime,
                    isPlaying: room.isPlaying,
                    videoId: room.currentVideoId
                });
                console.log(`Sync sent to ${socket.id}, diff: ${diff.toFixed(2)}s`);
            }
        }
    });
    
    socket.on('chat-message', ({ roomId, userName, message }) => {
        io.to(roomId).emit('chat-message', { userName, message });
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
                    console.log(`Room ${roomId} deleted`);
                }
            }
        }
        socket.leave(roomId);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Disconnected:', socket.id);
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
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📱 Open: http://localhost:${PORT}\n`);
});
