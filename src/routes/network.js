import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import Person from '../models/Person.js';

const router = express.Router();

// Get network graph data
router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const people = await Person.find({ userId: req.user._id })
      .populate('connections.personId', 'name initials')
      .select('name initials avatar sentiment.closenessScore connections');

    // Transform data for graph visualization
    const nodes = people.map(person => ({
      id: person._id,
      name: person.name,
      initials: person.initials,
      avatar: person.avatar,
      closeness: person.sentiment?.closenessScore || 0.5,
    }));

    const edges = [];
    people.forEach(person => {
      if (person.connections) {
        person.connections.forEach(conn => {
          edges.push({
            source: person._id,
            target: conn.personId?._id || conn.personId,
            strength: conn.strength || 0.5,
            type: conn.relationshipType,
          });
        });
      }
    });

    res.status(200).json({
      nodes,
      edges,
    });
  } catch (error) {
    next(error);
  }
});

// Get network statistics
router.get('/stats', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const totalPeople = await Person.countDocuments({ userId: req.user._id });
    
    const relationshipBreakdown = await Person.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$relationship.type', count: { $sum: 1 } } },
    ]);

    const averageCloseness = await Person.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: null, avgCloseness: { $avg: '$sentiment.closenessScore' } } },
    ]);

    const communicationFrequency = await Person.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$communication.frequency', count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      totalPeople,
      relationshipBreakdown,
      averageCloseness: averageCloseness[0]?.avgCloseness || 0,
      communicationFrequency,
    });
  } catch (error) {
    next(error);
  }
});

export default router;