const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  clerkId: {
    type: String,
    required: true,
    index: true
  },
  
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  
  
  transcript: {
    fullText: String,
    speakers: [{
      label: String,
      segments: [{
        text: String,
        start: Number,
        end: Number
      }],
      totalSpeakingTime: Number
    }]
  },
  
  insights: {
    speakers: mongoose.Schema.Types.Mixed,
    overallSummary: String
  },
  
  metadata: {
    meetingTitle: String,
    expectedSpeakers: Number,
    processingTimeMs: Number
  },
  
  error: {
    message: String,
    code: String
  },
  
  completedAt: Date
}, { timestamps: true });

transcriptSchema.index({ userId: 1, createdAt: -1 });
transcriptSchema.index({ userId: 1, status: 1 });
transcriptSchema.index({ clerkId: 1, createdAt: -1 });

module.exports = mongoose.model('Transcript', transcriptSchema);