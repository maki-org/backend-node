import express from 'express';
import multer from 'multer';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import { transcriptionLimiter } from '../middleware/rateLimiter.js';
import { transcribeAudio, assignSpeakers, formatTranscript } from '../services/transcriptionService.js';
import { extractInsights } from '../services/groqService.js';
import { parseDateTimeFromText } from '../services/dateParser.js';
import Transcript from '../models/Transcript.js';
import Reminder from '../models/Reminder.js';
import Task from '../models/Task.js';
import logger from '../utils/logger.js';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

router.post(
  '/',
  authenticateUser,
  syncUserToDatabase,
  transcriptionLimiter,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const numSpeakers = parseInt(req.body.num_speakers) || 2;
      logger.info(`Processing transcription for user: ${req.user._id}, file: ${req.file.originalname}`);

      const transcriptionResult = await transcribeAudio(req.file.buffer, req.file.originalname);
      
      let segments = transcriptionResult.segments || [];
      segments = assignSpeakers(segments, numSpeakers);

      const finalTranscript = formatTranscript(segments);

      const insights = await extractInsights(finalTranscript);

      const transcript = await Transcript.create({
        userId: req.user._id,
        filename: req.file.originalname,
        numSpeakers: insights.detected_speakers || numSpeakers,
        transcript: finalTranscript,
        insights: insights.speakers || {},
      });

      if (insights.reminders && insights.reminders.length > 0) {
        const reminderDocs = insights.reminders.map((reminder) => ({
          transcriptId: transcript._id,
          userId: req.user._id,
          filename: req.file.originalname,
          title: reminder.title,
          from: reminder.from,
          dueDate: reminder.due_date_text ? parseDateTimeFromText(reminder.due_date_text) : null,
          dueDateText: reminder.due_date_text,
          priority: reminder.priority,
          category: reminder.category,
          extractedFrom: reminder.extracted_from,
          completed: false,
        }));

        await Reminder.insertMany(reminderDocs);
        await Task.insertMany(reminderDocs);

        logger.info(`Created ${reminderDocs.length} reminders for user: ${req.user._id}`);
      }

      res.status(200).json({
        transcript: finalTranscript,
        insights: insights.speakers || {},
        reminders: insights.reminders || [],
        detected_speakers: insights.detected_speakers,
      });

    } catch (error) {
      next(error);
    }
  }
);

router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const transcripts = await Transcript.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-insights');

    res.status(200).json(transcripts);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const transcript = await Transcript.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.status(200).json(transcript);
  } catch (error) {
    next(error);
  }
});

export default router;