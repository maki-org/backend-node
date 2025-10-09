const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  clerkId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  name: String,
  
  usage: {
    transcriptionsCount: { type: Number, default: 0 },
    totalMinutesProcessed: { type: Number, default: 0 },
    lastTranscriptionAt: Date
  },
  
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'past_due'],
      default: 'active'
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);