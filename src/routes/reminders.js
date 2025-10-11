import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import Reminder from '../models/Reminder.js';

const router = express.Router();

router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { upcoming_only = 'true', limit = 50 } = req.query;
    
    const query = { userId: req.user._id };
    if (upcoming_only === 'true') {
      query.completed = false;
    }

    const reminders = await Reminder.find(query)
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json(reminders);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { completed, snooze_until } = req.body;

    const updateData = { updatedAt: new Date() };
    if (typeof completed === 'boolean') updateData.completed = completed;
    if (snooze_until) updateData.dueDate = new Date(snooze_until);

    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true }
    );

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.status(200).json({ message: 'Reminder updated', reminder });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const reminder = await Reminder.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.status(200).json({ message: 'Reminder deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;