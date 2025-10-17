import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import Conversation from '../models/Conversation.js';
import Person from '../models/Person.js';
import Transcript from '../models/Transcript.js';

const router = express.Router();

// Get all conversations with pagination and filters
router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      personId,
      startDate,
      endDate,
    } = req.query;

    const query = { userId: req.user._id };

    // Search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'summary.short': { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    // Person filter
    if (personId) {
      query['participants.personId'] = personId;
    }

    // Date range filter
    if (startDate || endDate) {
      query.conversationDate = {};
      if (startDate) query.conversationDate.$gte = new Date(startDate);
      if (endDate) query.conversationDate.$lte = new Date(endDate);
    }

    const conversations = await Conversation.find(query)
      .populate('participants.personId', 'name initials avatar')
      .sort({ conversationDate: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('-actionItems -pendingFollowups');  // Exclude large arrays for list view

    const total = await Conversation.countDocuments(query);

    res.status(200).json({
      conversations,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get single conversation with full details
router.get('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user._id,
    })
      .populate('participants.personId')
      .populate('transcriptId');

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.status(200).json(conversation);
  } catch (error) {
    next(error);
  }
});

// Get conversations by person
router.get('/person/:personId', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user._id,
      'participants.personId': req.params.personId,
    })
      .populate('participants.personId', 'name initials avatar')
      .sort({ conversationDate: -1 })
      .limit(50);

    res.status(200).json(conversations);
  } catch (error) {
    next(error);
  }
});

// Update conversation
router.patch('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { title, tags, summary } = req.body;

    const updateData = { updatedAt: new Date() };
    if (title) updateData.title = title;
    if (tags) updateData.tags = tags;
    if (summary) updateData.summary = summary;

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.status(200).json({ message: 'Conversation updated', conversation });
  } catch (error) {
    next(error);
  }
});

// Delete conversation
router.delete('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.status(200).json({ message: 'Conversation deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;