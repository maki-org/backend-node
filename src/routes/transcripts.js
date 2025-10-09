const express = require('express');
const multer = require('multer');
const path = require('path');
const { requireAuth, ensureUser } = require('../middleware/auth');
const { transcriptionLimiter } = require('../middleware/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const Transcript = require('../models/Transcript');
const { processTranscription } = require('../services/transcriptionService');
const { logger } = require('../utils/logger');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 100 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('File upload attempt:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      fieldname: file.fieldname
    });

    const allowedExts = ['.mp3', '.wav', '.m4a', '.webm', '.ogg', '.mp4'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExts.includes(ext)) {
      console.log('Rejected: invalid extension', ext);
      return cb(new Error(`Invalid file extension: ${ext}`));
    }
    
    console.log('Accepted file');
    cb(null, true);
  }
});

// MAIN AUTHENTICATED TRANSCRIBE ENDPOINT (matches frontend /transcribe/)
router.post('/',
  requireAuth,
  ensureUser,
  transcriptionLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const { num_speakers = 2 } = req.body;

    logger.info(`Transcription request from user: ${req.user.email}, clerk: ${req.user.clerkId}`);

    // Create transcript record linked to authenticated user
    const transcript = await Transcript.create({
      userId: req.user._id,
      clerkId: req.user.clerkId,
      status: 'pending',
      metadata: {
        expectedSpeakers: parseInt(num_speakers),
        meetingTitle: `Recording ${new Date().toISOString()}`
      }
    });

    // Start background processing
    setImmediate(() => {
      processTranscription(transcript._id, req.file.buffer).catch(err => {
        logger.error('Background processing failed:', err);
      });
    });

    res.status(202).json({
      transcript_id: transcript._id,
      status: 'pending',
      message: 'Transcription started'
    });
  })
);


router.get('/',
  requireAuth,
  ensureUser,
  asyncHandler(async (req, res) => {
    const { status, limit = 50, skip = 0 } = req.query;

    const query = { userId: req.user._id };
    if (status) query.status = status;

    const transcripts = await Transcript
      .find(query)
      .select('-audio.filename')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Transcript.countDocuments(query);

    res.json({
      transcripts,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: total > parseInt(skip) + transcripts.length
      }
    });
  })
);


router.get('/:id',
  requireAuth,
  ensureUser,
  asyncHandler(async (req, res) => {
    const transcript = await Transcript
      .findOne({
        _id: req.params.id,
        userId: req.user._id
      })
      .select('-audio.filename')
      .lean();

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.json(transcript);
  })
);

module.exports = router;