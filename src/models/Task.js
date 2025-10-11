import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  transcriptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transcript',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  filename: String,
  title: {
    type: String,
    required: true,
  },
  from: String,
  dueDate: Date,
  dueDateText: String,
  priority: {
    type: String,
    enum: ['high', 'normal', 'low'],
    default: 'normal',
  },
  category: {
    type: String,
    enum: ['meeting', 'call', 'task', 'deadline', 'personal'],
    default: 'task',
  },
  extractedFrom: String,
  completed: {
    type: Boolean,
    default: false,
    index: true,
  },
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

taskSchema.index({ userId: 1, completed: 1, dueDate: 1 });

export default mongoose.model('Task', taskSchema);