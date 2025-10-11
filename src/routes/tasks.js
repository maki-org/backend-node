import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import Task from '../models/Task.js';

const router = express.Router();

router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { completed = 'false', limit = 50 } = req.query;
    
    const query = { userId: req.user._id };
    if (completed !== 'all') {
      query.completed = completed === 'true';
    }

    const tasks = await Task.find(query)
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json(tasks);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { completed, title, priority, category, dueDate } = req.body;

    const updateData = { updatedAt: new Date() };
    if (typeof completed === 'boolean') updateData.completed = completed;
    if (title) updateData.title = title;
    if (priority) updateData.priority = priority;
    if (category) updateData.category = category;
    if (dueDate) updateData.dueDate = new Date(dueDate);

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(200).json({ message: 'Task updated', task });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const task = await Task.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(200).json({ message: 'Task deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;