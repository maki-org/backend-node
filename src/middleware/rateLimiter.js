import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';

export const transcriptionLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 50,
  message: 'Too many transcription requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for user: ${req.auth?.userId}`);
    res.status(429).json({
      error: 'Too many requests, please try again later'
    });
  },
  skip: (req) => process.env.NODE_ENV === 'development'
});

export const generalLimiter = rateLimit({
  windowMs: 60000,
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});