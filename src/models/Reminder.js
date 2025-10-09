const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
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
  transcriptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transcript',
    index: true
  },
  
  title: {
    type: String,
    required: true,
    trim: true
  },
  
  from: String,
  extractedFrom: String,
  
  dueDate: Date,
  dueDateText: String,
  
  priority: {
    type: String,
    enum: ['high', 'normal', 'low'],
    default: 'normal'
  },
  
  category: {
    type: String,
    enum: ['meeting', 'call', 'task', 'deadline', 'personal', 'email', 'followup'], 
    default: 'task'
  },
  
  completed: {
    type: Boolean,
    default: false,
    index: true
  },
  
  completedAt: Date
}, { timestamps: true });

reminderSchema.index({ userId: 1, completed: 1, dueDate: 1 });
reminderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Reminder', reminderSchema);