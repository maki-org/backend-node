const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { convertToWav } = require('./audioProcessor');
const { transcribeAudio, extractInsights } = require('./groqService');
const { parseDateTimeFromText } = require('./dateParser');
const Transcript = require('../models/Transcript');
const Reminder = require('../models/Reminder');
const { logger } = require('../utils/logger');

async function processTranscription(transcriptId, audioBuffer) {
  const transcript = await Transcript.findById(transcriptId);
  if (!transcript) throw new Error('Transcript not found');

  const startTime = Date.now();
  const tempWavPath = `/tmp/${crypto.randomBytes(8).toString('hex')}.wav`;

  try {
    transcript.status = 'processing';
    await transcript.save();

    await convertToWav(audioBuffer, tempWavPath);

    const segments = await transcribeAudio(tempWavPath, transcript.metadata.expectedSpeakers);
    await fs.unlink(tempWavPath);

    const fullText = segments.map(s => s.text).join(' ');
    const speakers = groupBySpeaker(segments);

    const insights = await extractInsights(fullText, speakers);

    transcript.status = 'completed';
    transcript.transcript = { fullText, speakers };
    transcript.insights = insights;
    transcript.metadata.processingTimeMs = Date.now() - startTime;
    transcript.completedAt = new Date();
    await transcript.save();

    if (insights.reminders) {
      await saveReminders(insights.reminders, transcript);
    }

    logger.info(`Completed: ${transcriptId}`);
  } catch (error) {
    logger.error(`Failed: ${transcriptId}`, error);
    
    transcript.status = 'failed';
    transcript.error = { message: error.message };
    await transcript.save();
    
    try { await fs.unlink(tempWavPath); } catch {}
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
  const reminderDocs = reminders.map(reminder => ({
    userId: transcript.userId,
    clerkId: transcript.clerkId,
    transcriptId: transcript._id,
    title: reminder.title.trim(),
    from: reminder.from,
    extractedFrom: reminder.extracted_from,
    dueDate: reminder.due_date_text ? parseDateTimeFromText(reminder.due_date_text) : null,
    dueDateText: reminder.due_date_text,
    priority: reminder.priority || 'normal',
    category: reminder.category || 'task'
  }));

  if (reminderDocs.length > 0) {
    await Reminder.insertMany(reminderDocs);
  }
}

module.exports = { processTranscription };