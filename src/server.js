import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import dotenv from 'dotenv';
import { clerkMiddleware } from '@clerk/express';
import connectDB from './config/database.js';
import initializeGroq from './config/groq.js';
import logger from './utils/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { clerkWebhookHandler } from './middleware/auth.js';

import healthRoutes from './routes/health.js';
import transcriptRoutes from './routes/transcripts.js';
import reminderRoutes from './routes/reminders.js';
import taskRoutes from './routes/tasks.js';
import conversationRoutes from './routes/conversations.js';
import peopleRoutes from './routes/people.js';
import followupRoutes from './routes/followups.js';
import networkRoutes from './routes/network.js';
import intelligenceRoutes from './routes/intelligence.js';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(','),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(compression());

app.post('/webhooks/clerk', 
  express.json({ 
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  }), 
  clerkWebhookHandler
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(mongoSanitize());

app.use(clerkMiddleware());

app.use(generalLimiter);

app.get('/', (req, res) => {
  res.json({
    message: 'Maki AI Backend API',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date(),
  });
});

const apiV1Router = express.Router();

apiV1Router.use('/health', healthRoutes);
apiV1Router.use('/transcripts', transcriptRoutes);
apiV1Router.use('/reminders', reminderRoutes);
apiV1Router.use('/tasks', taskRoutes);
apiV1Router.use('/conversations', conversationRoutes);
apiV1Router.use('/people', peopleRoutes);
apiV1Router.use('/followups', followupRoutes);
apiV1Router.use('/network', networkRoutes);
apiV1Router.use('/intelligence', intelligenceRoutes);

app.use('/api/v1', apiV1Router);

app.use(notFound);
app.use(errorHandler);

const startServer = async () => {
  try {
    await connectDB();
    
    initializeGroq();

    if (!process.env.CLERK_WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
      logger.warn('CLERK_WEBHOOK_SECRET not set - webhooks will not work in production');
    }

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
      logger.info(`CORS enabled for: ${process.env.CORS_ORIGIN}`);
      logger.info(`Webhook endpoint: /webhooks/clerk`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

startServer();