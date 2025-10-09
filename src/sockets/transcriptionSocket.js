const { Server } = require('socket.io');
const { clerkClient } = require('@clerk/express');
const { logger } = require('../utils/logger');

function initializeSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:8080',
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        logger.error('Socket auth: No token provided');
        return next(new Error('No token provided'));
      }
      
      try {
        // Use clerkClient.verifyToken from @clerk/express
        const session = await clerkClient.sessions.verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY
        });
        
        socket.data.clerkId = session.userId;
        logger.info(`✓ Socket authenticated: ${session.userId}`);
        next();
      } catch (verifyError) {
        logger.error('Token verification failed:', verifyError.message);
        return next(new Error('Invalid token'));
      }
    } catch (error) {
      logger.error('Socket auth failed:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const clerkId = socket.data.clerkId;
    logger.info(`✓ Socket connected: ${clerkId}`);
    
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