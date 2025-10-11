import { getGroqClient } from '../config/groq.js';
import logger from '../utils/logger.js';

export const transcribeAudio = async (audioBuffer, filename) => {
  try {
    const groq = getGroqClient();

    const file = new File([audioBuffer], filename, {
      type: 'audio/webm',
    });

    logger.info(`Starting transcription for: ${filename}`);

    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      language: 'en',
    });

    logger.info(`Transcription completed for: ${filename}`);
    return transcription;
  } catch (error) {
    logger.error(`Transcription error: ${error.message}`);
    throw new Error(`Transcription failed: ${error.message}`);
  }
};

export const assignSpeakers = (segments, numSpeakers) => {
  const speakerMapping = new Map();
  let currentSpeakerIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentKey = `${Math.floor(segment.start / 10)}`;

    if (!speakerMapping.has(segmentKey)) {
      speakerMapping.set(segmentKey, `SPEAKER ${(currentSpeakerIndex % numSpeakers) + 1}`);
      currentSpeakerIndex++;
    }

    segment.speaker = speakerMapping.get(segmentKey);
  }

  return segments;
};

export const formatTranscript = (segments) => {
  let transcript = '';
  let currentSpeaker = null;

  for (const segment of segments) {
    const speaker = segment.speaker || 'Unknown';
    const start = new Date(segment.start * 1000).toISOString().substr(11, 8);
    const end = new Date(segment.end * 1000).toISOString().substr(11, 8);
    const text = segment.text.trim();

    if (speaker !== currentSpeaker) {
      transcript += `\n[${start} - ${end}] ${speaker}:\n`;
      currentSpeaker = speaker;
    }

    transcript += `${text} `;
  }

  return transcript.trim();
};