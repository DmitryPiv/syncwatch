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

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('✅ Connected:', socket.id);
    
    socket.on('join-room', ({ roomId, userId, userName }) => {
        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                users: [],
                creatorId: userId,
                platform: 'youtube', // 'youtube', 'rutube', 'vk'
                currentVideoId: 'dQw4w9WgXcQ',
                currentTime: 0,
                isPlaying: false
            });
        }
        
        const room = rooms.get(roomId);
        const existingUser = room.users.find(u => u.id === userId);
        
        if (!existingUser) {
            room.users.push({ id: userId, name: userName, socketId: socket.id });
        }
        
        // Отправляем текущее состояние новому пользователю
        socket.emit('room-state', {
            platform: room.platform,
            videoId: room.currentVideoId,
            currentTime: room.currentTime,
            isPlaying: room.isPlaying,
            isCreator: userId === room.creatorId
        });
        
        // Отправляем список пользователей
        io.to(roomId).emit('users-list', { 
            users: room.users.map(u => ({ name: u.name, id: u.id })),
            creatorId: room.creatorId
        });
        
        socket.to(roomId).emit('user-joined', { userName, userCount: room.users.length });
        
        console.log(`${userName} joined ${roomId}, users: ${room.users.length}`);
    });
    
    // Смена платформы (только для создателя)
    socket.on('change-platform', ({ roomId, userId, platform, videoId }) => {
        const room = rooms.get(roomId);
        if (room && room.creatorId === userId) {
            room.platform = platform;
            room.currentVideoId = videoId;
            room.currentTime = 0;
            room.isPlaying = false;
            
            io.to(roomId).emit('platform-changed', { platform, videoId });
            console.log(`Platform changed in ${roomId} to ${platform}`);
        }
    });
    
    socket.on('play-video', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.isPlaying = true;
            room.currentTime = time;
            socket.to(roomId).emit('video-play', { time });
        }
    });
    
    socket.on('pause-video', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.isPlaying = false;
            room.currentTime = time;
            socket.to(roomId).emit('video-pause', { time });
        }
    });
    
    socket.on('seek-video', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.currentTime = time;
            socket.to(roomId).emit('video-seek', { time });
        }
    });
    
    socket.on('change-video', ({ roomId, videoId }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.currentVideoId = videoId;
            room.currentTime = 0;
            room.isPlaying = false;
            socket.to(roomId).emit('video-changed', { videoId });
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
                io.to(roomId).emit('user-left', { userName: user.name, userCount: room.users.length });
                
                if (room.users.length === 0) {
                    rooms.delete(roomId);
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
                io.to(roomId).emit('user-left', { userName: user.name, userCount: room.users.length });
                if (room.users.length === 0) rooms.delete(roomId);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}\n`);
});
