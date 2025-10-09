const { getGroqClient } = require('../config/groq');
const { logger } = require('../utils/logger');
const fs = require('fs').promises;

async function transcribeAudio(audioPath, numSpeakers = 2) {
  const client = getGroqClient();
  
  try {
    const audioBuffer = await fs.readFile(audioPath);
    
    const transcription = await client.audio.transcriptions.create({
      file: audioBuffer,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      language: 'en'
    });

    const segments = transcription.segments || [];
    
    segments.forEach((segment, index) => {
      segment.speaker = `SPEAKER ${(index % numSpeakers) + 1}`;
    });

    return segments;
  } catch (error) {
    logger.error('Groq transcription failed:', error);
    throw new Error('Transcription failed');
  }
}

async function extractInsights(fullTranscript, speakers) {
  const client = getGroqClient();
  
  const speakerContext = speakers.map(s => 
    `${s.label}: ${s.segments.slice(0, 3).map(seg => seg.text).join(' ')}`
  ).join('\n');

  const prompt = `Analyze this meeting transcript and extract insights PER SPEAKER.

Transcript:
${fullTranscript}

Speakers:
${speakerContext}

Extract:
1. Action items per speaker
2. Key information per speaker
3. Reminders with exact deadline phrasing

Return JSON:
{
  "speakers": {
    "SPEAKER 1": {
      "action_items": [],
      "key_information": []
    }
  },
  "reminders": [
    {
      "title": "",
      "from": "SPEAKER X",
      "due_date_text": null or "exact phrase",
      "priority": "high|normal|low",
      "category": "meeting|call|task|deadline|personal",
      "extracted_from": ""
    }
  ]
}`;

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    logger.error('Insights extraction failed:', error);
    return { speakers: {}, reminders: [] };
  }
}

module.exports = { transcribeAudio, extractInsights };