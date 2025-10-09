const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URL, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    logger.info('MongoDB connected');
    await createIndexes();
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    throw error;
  }
}

async function createIndexes() {
  const User = require('../models/User');
  const Transcript = require('../models/Transcript');
  const Reminder = require('../models/Reminder');

  try {
    await Promise.all([
      User.createIndexes(),
      Transcript.createIndexes(),
      Reminder.createIndexes()
    ]);
    logger.info('Database indexes created');
  } catch (error) {
    logger.error('Index creation failed:', error);
  }
}

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

module.exports = { connectDatabase };