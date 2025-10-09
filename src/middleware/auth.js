const { clerkMiddleware, requireAuth: clerkRequireAuth, clerkClient } = require('@clerk/express');
const User = require('../models/User');
const { logger } = require('../utils/logger');


const clerkAuth = clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY
});


async function requireAuth(req, res, next) {
  if (!req.auth || !req.auth.userId) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Missing or invalid authentication token'
    });
  }
  next();
}

async function ensureUser(req, res, next) {
  try {
    const clerkId = req.auth.userId;
    
    let user = await User.findOne({ clerkId });
    
    if (!user) {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      
      user = await User.create({
        clerkId,
        email: clerkUser.emailAddresses[0].emailAddress,
        name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim()
      });
      
      logger.info(`New user created: ${clerkId}`);
    }
    
    req.user = user;
    next();
  } catch (error) {
    logger.error('User verification failed:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

module.exports = { clerkAuth, requireAuth, ensureUser };