import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import Person from '../models/Person.js';
import Conversation from '../models/Conversation.js';
import FollowUp from '../models/FollowUp.js';

const router = express.Router();

// Get personal intelligence dashboard data
router.get('/dashboard', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    // Pending follow-ups
    const pendingFollowUps = await FollowUp.find({
      userId: req.user._id,
      type: 'pending',
      completed: false,
    })
      .populate('personId', 'name initials avatar relationship')
      .sort({ priority: 1 })
      .limit(3);

    // Suggested follow-ups (top contacts to reconnect with)
    const suggestedFollowUps = await Person.find({
      userId: req.user._id,
      'communication.lastContacted': { $exists: true },
    })
      .sort({ 'communication.lastContacted': 1 })
      .limit(6)
      .select('name initials avatar relationship communication.lastContacted communication.frequency sentiment.closenessScore');

    // Latest interactions
    const latestInteractions = await Conversation.find({
      userId: req.user._id,
    })
      .sort({ conversationDate: -1 })
      .limit(4)
      .populate('participants.personId', 'name initials avatar')
      .select('title summary.short conversationDate duration participants');

    // Network overview
    const totalPeople = await Person.countDocuments({ userId: req.user._id });
    const closeContacts = await Person.countDocuments({
      userId: req.user._id,
      'sentiment.closenessScore': { $gte: 0.7 },
    });

    res.status(200).json({
      pendingFollowUps,
      suggestedFollowUps,
      latestInteractions,
      networkOverview: {
        totalPeople,
        closeContacts,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;