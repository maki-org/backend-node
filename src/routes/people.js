import express from 'express';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import Person from '../models/Person.js';
import Conversation from '../models/Conversation.js';

const router = express.Router();

// Get all people with filters
router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { 
      search = '',
      relationship,
      sortBy = 'lastContacted',  // lastContacted, closeness, name, frequency
      limit = 100,
    } = req.query;

    const query = { userId: req.user._id };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'relationship.type': { $regex: search, $options: 'i' } },
        { 'profile.keyInfo.interests': { $regex: search, $options: 'i' } },
      ];
    }

    if (relationship) {
      query['relationship.type'] = relationship;
    }

    let sortOption = {};
    switch (sortBy) {
      case 'lastContacted':
        sortOption = { 'communication.lastContacted': -1 };
        break;
      case 'closeness':
        sortOption = { 'sentiment.closenessScore': -1 };
        break;
      case 'name':
        sortOption = { name: 1 };
        break;
      case 'frequency':
        sortOption = { 'communication.totalConversations': -1 };
        break;
      default:
        sortOption = { 'communication.lastContacted': -1 };
    }

    const people = await Person.find(query)
      .sort(sortOption)
      .limit(parseInt(limit));

    res.status(200).json(people);
  } catch (error) {
    next(error);
  }
});


router.get('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const person = await Person.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).populate('connections.personId', 'name initials avatar');

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Get recent conversations with this person
    const recentConversations = await Conversation.find({
      userId: req.user._id,
      'participants.personId': req.params.id,
    })
      .sort({ conversationDate: -1 })
      .limit(10)
      .select('title summary conversationDate duration tags actionItems');

    // Extract most discussed topics from conversations
    const mostDiscussedTopics = await extractMostDiscussedTopics(
      req.user._id, 
      req.params.id
    );

    // Calculate communication frequency label
    const frequencyLabel = getCommunicationFrequencyLabel(
      person.communication.frequency,
      person.communication.totalConversations
    );

    // Format response for the UI
    const response = {
      // Basic Info
      id: person._id,
      name: person.name,
      initials: person.initials,
      avatar: person.avatar,
      
      // Relationship
      relationship: {
        type: person.relationship?.type,
        subtype: person.relationship?.subtype,
        displayText: person.relationship?.subtype || person.relationship?.type || 'Contact',
      },
      
      // Communication Details
      communication: {
        lastContacted: person.communication.lastContacted,
        lastContactedFormatted: formatLastContacted(person.communication.lastContacted),
        frequency: person.communication.frequency,
        frequencyLabel: frequencyLabel,
        frequencyBadgeColor: getFrequencyBadgeColor(frequencyLabel),
        totalConversations: person.communication.totalConversations,
        conversationCounter: person.communication.conversationCounter,
      },
      
      // Sentiment & Closeness
      sentiment: {
        closenessScore: person.sentiment?.closenessScore || 0.5,
        closenessPercentage: Math.round((person.sentiment?.closenessScore || 0.5) * 100),
        tone: person.sentiment?.tone || 'neutral',
      },
      
      // Profile Information
      profile: {
        summary: person.profile?.summary || 'No information available yet.',
        
        // Hobbies & Interests
        hobbies: person.profile?.keyInfo?.hobbies || [],
        interests: person.profile?.keyInfo?.interests || [],
        
        // Favorites
        favorites: {
          movies: person.profile?.keyInfo?.favorites?.movies || [],
          music: person.profile?.keyInfo?.favorites?.music || [],
          books: person.profile?.keyInfo?.favorites?.books || [],
          food: person.profile?.keyInfo?.favorites?.food || [],
        },
        
        // Travel
        travel: person.profile?.keyInfo?.travel || [],
        
        // Work Info
        workInfo: person.profile?.keyInfo?.workInfo || {},
        
        // Personal Info
        personalInfo: person.profile?.keyInfo?.personalInfo || {},
      },
      
      // Most Discussed Topics
      mostDiscussedTopics: mostDiscussedTopics,
      
      // Recent Conversations
      recentConversations: recentConversations.map(conv => ({
        id: conv._id,
        title: conv.title,
        summary: conv.summary?.short,
        date: conv.conversationDate,
        dateFormatted: formatConversationDate(conv.conversationDate),
        duration: conv.duration,
        tags: conv.tags,
        hasActionItems: conv.actionItems && conv.actionItems.length > 0,
      })),
      
      // Network Connections
      connections: person.connections?.map(conn => ({
        id: conn.personId._id,
        name: conn.personId.name,
        initials: conn.personId.initials,
        avatar: conn.personId.avatar,
        relationshipType: conn.relationshipType,
        strength: conn.strength,
      })) || [],
      
      // Metadata
      createdAt: person.createdAt,
      updatedAt: person.updatedAt,
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

// Helper function to extract most discussed topics
async function extractMostDiscussedTopics(userId, personId) {
  try {
    const conversations = await Conversation.find({
      userId: userId,
      'participants.personId': personId,
    }).select('title summary tags');

    // Use the person's stored common topics if available
    const person = await Person.findById(personId).select('profile.commonTopics');
    
    if (person?.profile?.commonTopics && person.profile.commonTopics.length > 0) {
      // Return stored topics, sorted by frequency
      return person.profile.commonTopics
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10)
        .map(t => t.topic);
    }

    // Otherwise, extract from conversation tags and titles
    const topicsMap = new Map();
    
    conversations.forEach(conv => {
      // Count tags
      if (conv.tags) {
        conv.tags.forEach(tag => {
          topicsMap.set(tag, (topicsMap.get(tag) || 0) + 1);
        });
      }
      
      // Extract key phrases from titles
      if (conv.title) {
        const words = conv.title.toLowerCase().split(' ');
        words.forEach(word => {
          if (word.length > 4) { // Only meaningful words
            topicsMap.set(word, (topicsMap.get(word) || 0) + 1);
          }
        });
      }
    });

    // Convert to array and sort by frequency
    const topics = Array.from(topicsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);

    return topics;
  } catch (error) {
    console.error('Error extracting topics:', error);
    return [];
  }
}

// Helper function to format last contacted time
function formatLastContacted(date) {
  if (!date) return 'Never';
  
  const now = new Date();
  const lastContact = new Date(date);
  const diffInMs = now - lastContact;
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInMinutes < 60) {
    return `${diffInMinutes}min ago`;
  } else if (diffInHours < 24) {
    const timeStr = lastContact.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${timeStr}. Today`;
  } else if (diffInDays === 1) {
    const timeStr = lastContact.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${timeStr}. Yesterday`;
  } else if (diffInDays < 7) {
    const dayName = lastContact.toLocaleDateString('en-US', { weekday: 'long' });
    const timeStr = lastContact.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${timeStr}. ${dayName}`;
  } else {
    return lastContact.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

// Helper function to get communication frequency label
function getCommunicationFrequencyLabel(frequency, totalConversations) {
  if (totalConversations >= 50) return 'Excellent';
  if (totalConversations >= 20) return 'Great';
  if (totalConversations >= 10) return 'Good';
  
  switch (frequency) {
    case 'daily':
      return 'Excellent';
    case 'weekly':
      return 'Great';
    case 'monthly':
      return 'Good';
    case 'quarterly':
      return 'Occasional';
    case 'yearly':
      return 'Rare';
    default:
      return 'Rare';
  }
}

// Helper function to get badge color for frequency
function getFrequencyBadgeColor(label) {
  const colorMap = {
    'Excellent': 'green',
    'Great': 'blue',
    'Good': 'cyan',
    'Occasional': 'yellow',
    'Rare': 'orange',
  };
  return colorMap[label] || 'gray';
}

// Helper function to format conversation date
function formatConversationDate(date) {
  const convDate = new Date(date);
  const now = new Date();
  const diffInDays = Math.floor((now - convDate) / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  
  return convDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Create or update person
router.post('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const personData = {
      ...req.body,
      userId: req.user._id,
    };

    // Check if person already exists
    const existingPerson = await Person.findOne({
      userId: req.user._id,
      name: { $regex: new RegExp(`^${req.body.name}$`, 'i') },
    });

    if (existingPerson) {
      return res.status(409).json({ 
        error: 'Person already exists',
        personId: existingPerson._id,
      });
    }

    const person = await Person.create(personData);

    res.status(201).json({ message: 'Person created', person });
  } catch (error) {
    next(error);
  }
});

// Update person
router.patch('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const person = await Person.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.status(200).json({ message: 'Person updated', person });
  } catch (error) {
    next(error);
  }
});

// Delete person
router.delete('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const person = await Person.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.status(200).json({ message: 'Person deleted' });
  } catch (error) {
    next(error);
  }
});


router.get('/:id/timeline', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { limit = 20, page = 1 } = req.query;

    const conversations = await Conversation.find({
      userId: req.user._id,
      'participants.personId': req.params.id,
    })
      .sort({ conversationDate: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('participants.personId', 'name initials avatar');

    const total = await Conversation.countDocuments({
      userId: req.user._id,
      'participants.personId': req.params.id,
    });

    res.status(200).json({
      conversations,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get person's action items
router.get('/:id/action-items', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user._id,
      'participants.personId': req.params.id,
    })
      .select('actionItems conversationDate title')
      .sort({ conversationDate: -1 });

    const allActionItems = [];
    
    conversations.forEach(conv => {
      if (conv.actionItems && conv.actionItems.length > 0) {
        conv.actionItems.forEach(item => {
          allActionItems.push({
            ...item,
            conversationId: conv._id,
            conversationTitle: conv.title,
            conversationDate: conv.conversationDate,
          });
        });
      }
    });

    res.status(200).json({
      actionItems: allActionItems,
      total: allActionItems.length,
    });
  } catch (error) {
    next(error);
  }
});

// Update person's notes/summary
router.patch('/:id/notes', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { notes } = req.body;

    if (!notes) {
      return res.status(400).json({ error: 'Notes are required' });
    }

    const person = await Person.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { 
        'profile.summary': notes,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.status(200).json({ 
      message: 'Notes updated',
      summary: person.profile.summary,
    });
  } catch (error) {
    next(error);
  }
});

// Initiate call/contact action (just logs the action)
router.post('/:id/contact', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { contactType = 'call', notes } = req.body; // 'call', 'message', 'email'

    const person = await Person.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Update last contacted
    person.communication.lastContacted = new Date();
    await person.save();

    // Optionally log this interaction
    // You could create a ContactLog model for this

    res.status(200).json({
      message: `${contactType} initiated with ${person.name}`,
      lastContacted: person.communication.lastContacted,
    });
  } catch (error) {
    next(error);
  }
});

// Search within person's conversations
router.get('/:id/search', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const conversations = await Conversation.find({
      userId: req.user._id,
      'participants.personId': req.params.id,
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { 'summary.short': { $regex: query, $options: 'i' } },
        { 'summary.extended': { $regex: query, $options: 'i' } },
      ],
    })
      .sort({ conversationDate: -1 })
      .limit(20)
      .select('title summary conversationDate tags');

    res.status(200).json({
      query,
      results: conversations,
      count: conversations.length,
    });
  } catch (error) {
    next(error);
  }
});


router.get('/:id/analytics', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const person = await Person.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Get all conversations
    const conversations = await Conversation.find({
      userId: req.user._id,
      'participants.personId': req.params.id,
    }).select('conversationDate duration tags actionItems');

    // Calculate metrics
    const totalConversations = conversations.length;
    const totalDuration = conversations.reduce((sum, conv) => sum + (conv.duration || 0), 0);
    const averageDuration = totalConversations > 0 ? totalDuration / totalConversations : 0;

    // Conversation frequency over time
    const conversationsByMonth = {};
    conversations.forEach(conv => {
      const monthKey = new Date(conv.conversationDate).toISOString().slice(0, 7); // YYYY-MM
      conversationsByMonth[monthKey] = (conversationsByMonth[monthKey] || 0) + 1;
    });

    // Most common tags
    const tagFrequency = {};
    conversations.forEach(conv => {
      if (conv.tags) {
        conv.tags.forEach(tag => {
          tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
        });
      }
    });

    const topTags = Object.entries(tagFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    // Action items count
    const totalActionItems = conversations.reduce(
      (sum, conv) => sum + (conv.actionItems?.length || 0), 
      0
    );

    // Communication pattern (day of week)
    const dayOfWeekPattern = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    conversations.forEach(conv => {
      const dayOfWeek = new Date(conv.conversationDate).getDay();
      dayOfWeekPattern[dayOfWeek]++;
    });

    res.status(200).json({
      personName: person.name,
      overview: {
        totalConversations,
        totalDurationMinutes: totalDuration,
        averageDurationMinutes: Math.round(averageDuration),
        totalActionItems,
        closenessScore: person.sentiment?.closenessScore || 0.5,
      },
      trends: {
        conversationsByMonth,
        dayOfWeekPattern: {
          labels: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          data: dayOfWeekPattern,
        },
      },
      topTopics: topTags,
      communicationHealth: {
        frequency: person.communication.frequency,
        lastContacted: person.communication.lastContacted,
        daysSinceLastContact: person.communication.lastContacted 
          ? Math.floor((Date.now() - person.communication.lastContacted) / (1000 * 60 * 60 * 24))
          : null,
        isOverdue: checkIfOverdue(person.communication),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to check if contact is overdue
function checkIfOverdue(communication) {
  if (!communication.lastContacted) return false;
  
  const daysSinceContact = Math.floor(
    (Date.now() - communication.lastContacted) / (1000 * 60 * 60 * 24)
  );

  const thresholds = {
    daily: 2,
    weekly: 10,
    monthly: 35,
    quarterly: 100,
    yearly: 400,
  };

  const threshold = thresholds[communication.frequency] || 30;
  return daysSinceContact > threshold;
}


router.post('/batch', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const { personIds } = req.body;

    if (!personIds || !Array.isArray(personIds)) {
      return res.status(400).json({ error: 'personIds array is required' });
    }

    const people = await Person.find({
      _id: { $in: personIds },
      userId: req.user._id,
    }).select('name initials avatar relationship communication.lastContacted sentiment.closenessScore');

    // Get latest conversation for each person
    const enrichedPeople = await Promise.all(
      people.map(async (person) => {
        const latestConversation = await Conversation.findOne({
          userId: req.user._id,
          'participants.personId': person._id,
        })
          .sort({ conversationDate: -1 })
          .select('title conversationDate summary');

        return {
          id: person._id,
          name: person.name,
          initials: person.initials,
          avatar: person.avatar,
          relationship: person.relationship?.subtype || person.relationship?.type,
          lastContacted: person.communication?.lastContacted,
          lastContactedFormatted: formatLastContacted(person.communication?.lastContacted),
          closeness: person.sentiment?.closenessScore || 0.5,
          latestInteraction: latestConversation ? {
            title: latestConversation.title,
            summary: latestConversation.summary?.short,
            date: latestConversation.conversationDate,
            timeAgo: formatTimeAgo(latestConversation.conversationDate),
          } : null,
        };
      })
    );

    res.status(200).json(enrichedPeople);
  } catch (error) {
    next(error);
  }
});

// Helper function to format time ago
function formatTimeAgo(date) {
  if (!date) return '';
  
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now - past) / 1000);
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  if (diffInHours < 24) return `${diffInHours}h ago`;
  if (diffInDays < 7) return `${diffInDays}d ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)}w ago`;
  if (diffInDays < 365) return `${Math.floor(diffInDays / 30)}mo ago`;
  return `${Math.floor(diffInDays / 365)}y ago`;
}

export default router;