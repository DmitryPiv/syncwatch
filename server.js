const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка Socket.IO для работы из любой сети
const io = socketIo(server, {
    cors: {
        origin: "*", // Разрешаем подключения с любых доменов
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true
});

// Раздаём статические файлы
app.use(express.static(__dirname));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check для хостинга
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Хранилище комнат
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('✅ Пользователь подключился:', socket.id);
    console.log('📍 IP:', socket.handshake.address);
    
    socket.on('join-room', ({ roomId, userId, userName }) => {
        socket.join(roomId);
        console.log(`📌 ${userName} (${userId}) вошёл в комнату ${roomId}`);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                users: [],
                videoState: { playing: false, currentTime: 0, videoId: 'dQw4w9WgXcQ' }
            });
        }
        
        const room = rooms.get(roomId);
        const existingUser = room.users.find(u => u.id === userId);
        
        if (!existingUser) {
            room.users.push({ id: userId, name: userName, socketId: socket.id });
        }
        
        // Отправляем текущее состояние видео новому пользователю
        socket.emit('sync-state', room.videoState);
        
        // Уведомляем остальных о новом пользователе
        socket.to(roomId).emit('user-joined', { 
            userName, 
            userCount: room.users.length,
            users: room.users.map(u => ({ name: u.name, id: u.id }))
        });
        
        // Отправляем текущий список пользователей всем в комнате
        io.to(roomId).emit('users-list', { 
            users: room.users.map(u => ({ name: u.name, id: u.id }))
        });
        
        console.log(`👥 В комнате ${roomId}: ${room.users.length} человек`);
    });
    
    socket.on('play', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState = { ...room.videoState, playing: true, currentTime: time };
            socket.to(roomId).emit('play', { time });
            console.log(`▶️ Play в комнате ${roomId} на ${time}s`);
        }
    });
    
    socket.on('pause', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState = { ...room.videoState, playing: false, currentTime: time };
            socket.to(roomId).emit('pause', { time });
            console.log(`⏸️ Pause в комнате ${roomId} на ${time}s`);
        }
    });
    
    socket.on('seek', ({ roomId, time }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState.currentTime = time;
            socket.to(roomId).emit('seek', { time });
            console.log(`⏩ Seek в комнате ${roomId} на ${time}s`);
        }
    });
    
    socket.on('video-change', ({ roomId, videoId }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.videoState.videoId = videoId;
            room.videoState.currentTime = 0;
            socket.to(roomId).emit('video-change', { videoId });
            console.log(`🎬 Смена видео в комнате ${roomId} на ${videoId}`);
        }
    });
    
    socket.on('chat-message', ({ roomId, userName, message }) => {
        io.to(roomId).emit('chat-message', { userName, message });
        console.log(`💬 ${userName}: ${message}`);
    });
    
    socket.on('sync-request', ({ roomId, time, playing }) => {
        const room = rooms.get(roomId);
        if (room && Math.abs(room.videoState.currentTime - time) > 1.5) {
            socket.emit('sync-state', room.videoState);
            console.log(`🔄 Синхронизация комнаты ${roomId}: ${room.videoState.currentTime}s`);
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
                    userCount: room.users.length,
                    users: room.users.map(u => ({ name: u.name, id: u.id }))
                });
                console.log(`👋 ${user.name} покинул комнату ${roomId}`);
                
                if (room.users.length === 0) {
                    rooms.delete(roomId);
                    console.log(`🗑️ Комната ${roomId} удалена (пуста)`);
                }
            }
        }
        socket.leave(roomId);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Пользователь отключился:', socket.id);
        // Очистка комнат при отключении
        for (let [roomId, room] of rooms.entries()) {
            const userIndex = room.users.findIndex(u => u.socketId === socket.id);
            if (userIndex !== -1) {
                const user = room.users[userIndex];
                room.users.splice(userIndex, 1);
                io.to(roomId).emit('user-left', { 
                    userName: user.name, 
                    userCount: room.users.length,
                    users: room.users.map(u => ({ name: u.name, id: u.id }))
                });
                if (room.users.length === 0) {
                    rooms.delete(roomId);
                }
                break;
            }
        }
    });
});

// Используем порт из переменных окружения (для хостинга)
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Принимаем подключения с любых IP

server.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════╗
║     🚀 SyncWatch Сервер запущен!       ║
╠════════════════════════════════════════╣
║  📱 Локально: http://localhost:${PORT}   ║
║  🌍 Внешний IP: http://0.0.0.0:${PORT}  ║
║  🔌 WebSocket: активен                 ║
║  👥 Rooms: готов к подключениям        ║
╚════════════════════════════════════════╝
    `);
});
