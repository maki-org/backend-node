import mongoose from 'mongoose';

const personSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  
  // Basic Info
  name: {
    type: String,
    required: true,
  },
  initials: String,  // For UI display
  avatar: String,    // URL or color code
  
  // Relationship Info
  relationship: {
    type: {
      type: String,
      enum: ['friend', 'family', 'colleague', 'client', 'investor', 'mentor', 'acquaintance', 'other'],
    },
    subtype: String,  // e.g., "brother", "sister", "manager", "CEO"
    source: String,   // Where/how they met (workplace, school, event, etc.)
  },
  
  // Communication Tracking
  communication: {
    lastContacted: Date,
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'rarely'],
    },
    totalConversations: {
      type: Number,
      default: 0,
    },
    conversationCounter: {
      type: Number,
      default: 0,
    },
  },
  
  // Sentiment Analysis
  sentiment: {
    closenessScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
    tone: {
      type: String,
      enum: ['warm', 'neutral', 'formal', 'casual', 'professional'],
    },
    lastAssessment: Date,
  },
  
  // Personal Intelligence
  profile: {
    summary: String,  // What we know about this person
    
    // Key Information
    keyInfo: {
      hobbies: [String],
      interests: [String],
      favorites: {
        movies: [String],
        music: [String],
        books: [String],
        food: [String],
      },
      travel: [String],
      workInfo: {
        company: String,
        position: String,
        industry: String,
      },
      personalInfo: {
        relatives: [String],
        pets: [String],
        birthdate: String,
        location: String,
      },
    },
    
    // Conversation Topics
    commonTopics: [{
      topic: String,
      frequency: Number,
    }],
    
    // Important Dates
    importantDates: [{
      date: Date,
      description: String,
      type: String,  // birthday, anniversary, etc.
    }],
  },
  
  // Network Connections
  connections: [{
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Person',
    },
    relationshipType: String,
    strength: Number,  // 0-1, how closely connected
  }],
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

personSchema.index({ userId: 1, name: 1 });
personSchema.index({ userId: 1, 'communication.lastContacted': -1 });
personSchema.index({ userId: 1, 'sentiment.closenessScore': -1 });

export default mongoose.model('Person', personSchema);