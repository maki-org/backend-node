const { getGroqClient } = require('../config/groq');
const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

async function transcribeAudio(audioBuffer, numSpeakers = 2) {
  const client = getGroqClient();
  const tempFile = path.join('/tmp', `audio-${Date.now()}.mp3`);
  
  try {
    logger.info(`Processing ${audioBuffer.length} bytes...`);
    
    // Write buffer to temp file (Groq SDK needs a file path)
    await writeFile(tempFile, audioBuffer);
    
    // Create read stream for Groq
    const audioStream = fs.createReadStream(tempFile);
    
    const transcription = await client.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      language: 'en'
    });

    // Clean up temp file
    await unlink(tempFile);

    const segments = transcription.segments || [];
    
    // Simple speaker diarization
    segments.forEach((segment, index) => {
      segment.speaker = `SPEAKER ${(index % numSpeakers) + 1}`;
    });

    logger.info(`✓ Transcribed ${segments.length} segments`);
    return segments;
  } catch (error) {
    // Clean up on error
    try { await unlink(tempFile); } catch {}
    
    logger.error('Groq transcription failed:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}


async function extractInsights(fullTranscript, speakers) {
  const client = getGroqClient();
  
  const maxLength = 15000;
  const truncatedTranscript = fullTranscript.length > maxLength 
    ? fullTranscript.substring(0, maxLength) + '...[truncated]'
    : fullTranscript;

  const speakerContext = speakers.map(s => 
    `${s.label}: ${s.segments.slice(0, 3).map(seg => seg.text).join(' ')}`
  ).join('\n');

const prompt = `Analyze this meeting transcript and extract insights PER SPEAKER.

Transcript:
${truncatedTranscript}

Speakers:
${speakerContext}

Extract:
1. Action items per speaker
2. Key information per speaker  
3. Reminders with exact deadline phrasing

IMPORTANT RULES:
- priority must be ONLY: "high", "normal", or "low" (NOT "medium")
- category must be ONLY: "meeting", "call", "task", "deadline", "personal", "email", "followup"

Return ONLY valid JSON:
{
  "speakers": {
    "SPEAKER 1": {
      "action_items": ["item1", "item2"],
      "key_information": ["info1", "info2"]
    },
    "SPEAKER 2": {
      "action_items": [],
      "key_information": []
    }
  },
  "reminders": [
    {
      "title": "Call John about project",
      "from": "SPEAKER 1",
      "due_date_text": "tomorrow at 2pm",
      "priority": "high",
      "category": "call",
      "extracted_from": "I need to call John tomorrow at 2pm"
    }
  ]
}`;

  try {
    logger.info('Extracting insights...');
    
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const insights = JSON.parse(response.choices[0].message.content);
    logger.info(`✓ Extracted ${insights.reminders?.length || 0} reminders`);
    
    return insights;
  } catch (error) {
    logger.error('Insights extraction failed:', error);
    return { speakers: {}, reminders: [] };
  }
}

module.exports = { transcribeAudio, extractInsights };