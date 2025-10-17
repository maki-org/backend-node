import { clerkClient, requireAuth } from '@clerk/express';
import { Webhook } from 'svix';
import logger from '../utils/logger.js';
import User from '../models/User.js';

export const authenticateUser = requireAuth();

export const syncUserToDatabase = async (req, res, next) => {
  try {
    //  FIX: Call req.auth() as a function
    const authData = req.auth();
    const userId = authData?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    //  FIX: Find existing user first
    let user = await User.findOne({ clerkId: userId });

    if (!user) {
      // User doesn't exist, fetch from Clerk and create
      try {
        const clerkUser = await clerkClient.users.getUser(userId);

        user = await User.create({
          clerkId: userId,
          email: clerkUser.emailAddresses[0]?.emailAddress,
          firstName: clerkUser.firstName,
          lastName: clerkUser.lastName,
        });

        logger.info(`New user synced to database: ${userId}`);
      } catch (createError) {
        
        if (createError.code === 11000) {
          // User was created by another request, fetch it
          user = await User.findOne({ clerkId: userId });
          if (!user) {
            throw new Error('User creation race condition');
          }
          logger.info(`User already exists (race condition handled): ${userId}`);
        } else {
          throw createError;
        }
      }
    } else {
     
      user.lastActive = new Date();
      await user.save();
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error(`User sync error: ${error.message}`);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export const clerkWebhookHandler = async (req, res) => {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    logger.error('CLERK_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const headers = {
    'svix-id': req.headers['svix-id'],
    'svix-timestamp': req.headers['svix-timestamp'],
    'svix-signature': req.headers['svix-signature'],
  };

  if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) {
    logger.error('Missing svix headers');
    return res.status(400).json({ error: 'Missing svix headers' });
  }

  const payload = JSON.stringify(req.body);

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt;

  try {
    evt = wh.verify(payload, headers);
  } catch (err) {
    logger.error(`Webhook verification failed: ${err.message}`);
    return res.status(400).json({ error: 'Webhook verification failed' });
  }

  const { type, data } = evt;

  try {
    switch (type) {
      case 'user.created':
        
        await User.findOneAndUpdate(
          { clerkId: data.id },
          {
            clerkId: data.id,
            email: data.email_addresses[0]?.email_address,
            firstName: data.first_name,
            lastName: data.last_name,
          },
          { upsert: true, new: true }
        );
        logger.info(`User created/updated via webhook: ${data.id}`);
        break;

      case 'user.updated':
        await User.findOneAndUpdate(
          { clerkId: data.id },
          {
            email: data.email_addresses[0]?.email_address,
            firstName: data.first_name,
            lastName: data.last_name,
            lastActive: new Date(),
          },
          { upsert: true }
        );
        logger.info(`User updated via webhook: ${data.id}`);
        break;

      case 'user.deleted':
        const deletedUser = await User.findOneAndDelete({ clerkId: data.id });
        if (deletedUser) {
          logger.info(`User deleted via webhook: ${data.id}`);
        }
        break;

      default:
        logger.warn(`Unhandled webhook event type: ${type}`);
    }

    res.status(200).json({ success: true, type });
  } catch (error) {
    logger.error(`Webhook processing error: ${error.message}`);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};