const { Server } = require('socket.io');
const { clerkClient } = require('@clerk/express');
const { logger } = require('../utils/logger');

function initializeSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('No token provided'));
      }
      
      const { userId } = await clerkClient.verifyToken(token);
      
      socket.data.clerkId = userId;
      next();
    } catch (error) {
      logger.error('Socket auth failed:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const clerkId = socket.data.clerkId;
    logger.info(`Socket connected: ${clerkId}`);
    
    socket.join(`user:${clerkId}`);
    
    socket.emit('connected', { 
      clerkId,
      timestamp: new Date().toISOString()
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${clerkId}, reason: ${reason}`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error for ${clerkId}:`, error);
    });
  });

  return io;
}

module.exports = { initializeSocketServer };