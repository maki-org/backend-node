const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { clerkAuth } = require('./middleware/auth'); // UPDATED
require('dotenv').config();

const { connectDatabase } = require('./config/database');
const { initializeSocketServer } = require('./sockets/transcriptionSocket');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { logger } = require('./utils/logger');

const healthRoutes = require('./routes/health');
const transcriptsRoutes = require('./routes/transcripts');
const remindersRoutes = require('./routes/reminders');

const app = express();
const server = http.createServer(app);

app.use(helmet());

app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:8080'
  ],
  credentials: true
}));

app.use(morgan('combined', {
  stream: { write: message => logger.info(message.trim()) }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply Clerk middleware (UPDATED - no redirect for API)
app.use(clerkAuth);

app.use('/health', healthRoutes);
app.use('/api/transcripts', apiLimiter, transcriptsRoutes);
app.use('/api/reminders', apiLimiter, remindersRoutes);

app.get('/', (req, res) => {
  res.json({
    service: 'Maki AI Backend',
    version: '2.0.0',
    status: 'running'
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path
  });
});

app.use(errorHandler);

async function startServer() {
  try {
    await connectDatabase();
    logger.info('✓ Database connected');

    const io = initializeSocketServer(server);
    global.io = io;
    logger.info('✓ WebSocket initialized');

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`✓ Server running on port ${PORT}`);
      logger.info(`✓ Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error('Startup failed:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received');
  server.close(() => process.exit(0));
});

startServer();