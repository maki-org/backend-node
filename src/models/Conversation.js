import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  transcriptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transcript',
    required: true,
  },
  

  title: {
    type: String,
    required: true,
  },
  summary: {
    short: String,      // One-line summary
    extended: String,   // Five-line summary
  },
  
  
  participants: [{
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Person',
    },
    speakerLabel: String,  // e.g., "SPEAKER 1"
    name: String,           // Extracted or assigned name
    isUser: {
      type: Boolean,
      default: false,
    },
  }],
  
  
  conversationDate: {
    type: Date,
    required: true,
  },
  duration: Number,  
  tags: [String],
  
  // Extracted Data
  actionItems: [{
    description: String,
    assignedTo: String,
    speaker: String,
    completed: {
      type: Boolean,
      default: false,
    },
  }],
  
  pendingFollowups: [{
    description: String,
    person: String,
    extractedFrom: String,
  }],
  
  // Metadata
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

conversationSchema.index({ userId: 1, conversationDate: -1 });
conversationSchema.index({ userId: 1, 'participants.personId': 1 });

export default mongoose.model('Conversation', conversationSchema);