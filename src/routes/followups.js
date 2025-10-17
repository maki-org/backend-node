import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import FollowUp from '../models/FollowUp.js';
import { calculateSuggestedFollowUps } from '../services/makiService.js';
import Person from '../models/Person.js';

const router = express.Router();

// Get all follow-ups
router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { type = 'all', completed = 'false' } = req.query;

    const query = { userId: req.user._id };

    if (type !== 'all') {
      query.type = type;
    }

    if (completed !== 'all') {
      query.completed = completed === 'true';
    }

    const followUps = await FollowUp.find(query)
      .populate('personId', 'name initials avatar relationship')
      .sort({ priority: 1, createdAt: -1 });

    res.status(200).json(followUps);
  } catch (error) {
    next(error);
  }
});

// Get pending follow-ups
router.get('/pending', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const followUps = await FollowUp.find({
      userId: req.user._id,
      type: 'pending',
      completed: false,
    })
      .populate('personId', 'name initials avatar relationship')
      .sort({ priority: 1, createdAt: -1 });

    res.status(200).json(followUps);
  } catch (error) {
    next(error);
  }
});

// Get suggested follow-ups (calculate dynamically)
router.get('/suggested', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    // Get existing suggested follow-ups
    const existingFollowUps = await FollowUp.find({
      userId: req.user._id,
      type: 'suggested',
      completed: false,
    })
      .populate('personId', 'name initials avatar relationship')
      .sort({ priority: 1 });

    // Calculate new suggestions based on communication patterns
    const newSuggestions = await calculateSuggestedFollowUps(req.user._id, Person);

    // Combine and deduplicate
    const allSuggestions = [...existingFollowUps];
    
    for (const suggestion of newSuggestions) {
      const exists = existingFollowUps.some(
        fu => fu.personId && fu.personId._id.toString() === suggestion.personId.toString()
      );
      
      if (!exists && allSuggestions.length < 10) {
        allSuggestions.push({
          ...suggestion,
          type: 'suggested',
          isNew: true,
        });
      }
    }

    res.status(200).json(allSuggestions);
  } catch (error) {
    next(error);
  }
});

// Create follow-up
router.post('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const followUpData = {
      ...req.body,
      userId: req.user._id,
    };

    const followUp = await FollowUp.create(followUpData);

    res.status(201).json({ message: 'Follow-up created', followUp });
  } catch (error) {
    next(error);
  }
});

// Update follow-up
router.patch('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { completed, priority, context } = req.body;

    const updateData = {};
    if (typeof completed === 'boolean') {
      updateData.completed = completed;
      if (completed) updateData.completedAt = new Date();
    }
    if (priority) updateData.priority = priority;
    if (context) updateData.context = context;

    const followUp = await FollowUp.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true }
    );

    if (!followUp) {
      return res.status(404).json({ error: 'Follow-up not found' });
    }

    res.status(200).json({ message: 'Follow-up updated', followUp });
  } catch (error) {
    next(error);
  }
});

// Delete follow-up
router.delete('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const followUp = await FollowUp.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!followUp) {
      return res.status(404).json({ error: 'Follow-up not found' });
    }

    res.status(200).json({ message: 'Follow-up deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;