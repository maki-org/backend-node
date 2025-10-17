import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  personId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Person',
    required: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
  },
  
  type: {
    type: String,
    enum: ['pending', 'suggested'],
    required: true,
  },
  
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  },
  
  context: {
    type: String,
    required: true,
  },
  
  reason: String,  // Why this follow-up is suggested
  
  suggestedDate: Date,
  
  completed: {
    type: Boolean,
    default: false,
  },
  
  completedAt: Date,
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

followUpSchema.index({ userId: 1, type: 1, completed: 1 });
followUpSchema.index({ userId: 1, personId: 1, completed: 1 });

export default mongoose.model('FollowUp', followUpSchema);