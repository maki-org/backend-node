const { transcribeAudio, extractInsights } = require('./groqService');
const { parseDateTimeFromText } = require('./dateParser');
const Transcript = require('../models/Transcript');
const Reminder = require('../models/Reminder');
const { logger } = require('../utils/logger');

async function processTranscription(transcriptId, audioBuffer) {
  const transcript = await Transcript.findById(transcriptId);
  if (!transcript) throw new Error('Transcript not found');

  const startTime = Date.now();
  const clerkId = transcript.clerkId;

  try {
  
    transcript.status = 'processing';
    await transcript.save();

   
    emitToUser(clerkId, 'transcription:status', {
      transcriptId: transcript._id,
      status: 'processing',
      message: 'Processing audio...'
    });

    // Transcribe audio
    logger.info(`Starting transcription for ${transcriptId}`);
    const segments = await transcribeAudio(
      audioBuffer, 
      transcript.metadata.expectedSpeakers
    );
    
    audioBuffer = null;
    if (global.gc) global.gc();

    // Emit transcription progress
    emitToUser(clerkId, 'transcription:progress', {
      transcriptId: transcript._id,
      stage: 'transcribed',
      message: 'Audio transcribed, extracting insights...'
    });

    const fullText = segments.map(s => s.text).join(' ');
    const speakers = groupBySpeaker(segments);

    // Extract insights
    logger.info(`Extracting insights for ${transcriptId}`);
    const insights = await extractInsights(fullText, speakers);

    // Save transcript
    transcript.status = 'completed';
    transcript.transcript = { fullText, speakers };
    transcript.insights = insights;
    transcript.metadata.processingTimeMs = Date.now() - startTime;
    transcript.completedAt = new Date();
    await transcript.save();

    // Save reminders
    if (insights.reminders && insights.reminders.length > 0) {
      await saveReminders(insights.reminders, transcript);
      
      // Emit reminders created event
      emitToUser(clerkId, 'reminders:created', {
        transcriptId: transcript._id,
        count: insights.reminders.length
      });
    }

    // Emit completion
    emitToUser(clerkId, 'transcription:complete', {
      transcriptId: transcript._id,
      status: 'completed',
      insights: {
        speakerCount: Object.keys(insights.speakers || {}).length,
        reminderCount: insights.reminders?.length || 0
      },
      processingTimeMs: transcript.metadata.processingTimeMs
    });

    logger.info(`✓ Completed: ${transcriptId} in ${transcript.metadata.processingTimeMs}ms`);
  } catch (error) {
    logger.error(`Failed: ${transcriptId}`, error);
    
    transcript.status = 'failed';
    transcript.error = { message: error.message, code: error.code };
    await transcript.save();

    // Emit error
    emitToUser(clerkId, 'transcription:error', {
      transcriptId: transcript._id,
      status: 'failed',
      error: error.message
    });
    
    throw error;
  }
}

function groupBySpeaker(segments) {
  const speakerMap = new Map();
  segments.forEach(seg => {
    if (!speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, {
        label: seg.speaker,
        segments: [],
        totalSpeakingTime: 0
      });
    }
    const speaker = speakerMap.get(seg.speaker);
    speaker.segments.push({ text: seg.text, start: seg.start, end: seg.end });
    speaker.totalSpeakingTime += (seg.end - seg.start);
  });
  return Array.from(speakerMap.values());
}

async function saveReminders(reminders, transcript) {
  const validCategories = ['meeting', 'call', 'task', 'deadline', 'personal', 'email', 'followup'];
  const validPriorities = ['high', 'normal', 'low'];
  
  const reminderDocs = reminders.map(reminder => {
    let category = (reminder.category || 'task').toLowerCase();
    if (!validCategories.includes(category)) {
      logger.warn(`Invalid category "${category}" replaced with "task"`);
      category = 'task';
    }

    let priority = (reminder.priority || 'normal').toLowerCase();
    if (priority === 'medium') {
      priority = 'normal';
    }
    if (!validPriorities.includes(priority)) {
      logger.warn(`Invalid priority "${priority}" replaced with "normal"`);
      priority = 'normal';
    }

    return {
      userId: transcript.userId,
      clerkId: transcript.clerkId,
      transcriptId: transcript._id,
      title: reminder.title.trim(),
      from: reminder.from,
      extractedFrom: reminder.extracted_from,
      dueDate: reminder.due_date_text ? parseDateTimeFromText(reminder.due_date_text) : null,
      dueDateText: reminder.due_date_text,
      priority: priority,
      category: category
    };
  });

  if (reminderDocs.length > 0) {
    await Reminder.insertMany(reminderDocs);
    logger.info(`✓ Saved ${reminderDocs.length} reminders`);
  }
}


function emitToUser(clerkId, event, data) {
  if (global.io) {
    global.io.to(`user:${clerkId}`).emit(event, data);
    logger.info(`Socket emit to user:${clerkId} - ${event}`);
  } else {
    logger.warn('Socket.io not initialized');
  }
}

module.exports = { processTranscription };