import mongoose from 'mongoose';

const transcriptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  filename: {
    type: String,
    required: true,
  },
  numSpeakers: {
    type: Number,
    default: 2,
  },
  transcript: {
    type: String,
    required: true,
  },
  insights: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

transcriptSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Transcript', transcriptSchema);