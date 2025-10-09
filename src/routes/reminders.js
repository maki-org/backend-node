const express = require('express');
const { requireAuth, ensureUser } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const Reminder = require('../models/Reminder');

const router = express.Router();

router.get('/',
  requireAuth,
  ensureUser,
  asyncHandler(async (req, res) => {
    const { completed, limit = 50 } = req.query;

    const query = { userId: req.user._id };
    if (completed !== undefined) {
      query.completed = completed === 'true';
    }
    const reminders = await Reminder
      .find(query)
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json(reminders);
  })
);

router.patch('/:id',
  requireAuth,
  ensureUser,
  asyncHandler(async (req, res) => {
    const { completed } = req.body;

    const reminder = await Reminder.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id
      },
      {
        completed,
        completedAt: completed ? new Date() : null
      },
      { new: true }
    );

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.json(reminder);
  })
);

module.exports = router;