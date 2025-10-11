import { getGroqClient } from '../config/groq.js';
import logger from '../utils/logger.js';

export const extractInsights = async (transcript) => {
  try {
    const groq = getGroqClient();

    const prompt = `Analyze the following transcript and extract insights.

Transcript:
${transcript}

Extract the following information:
1. Number of speakers detected in the conversation (analyze speech patterns, topics discussed, and conversation flow to determine the actual number of unique speakers)
2. Action items for each speaker
3. Key information shared by each speaker
4. Any reminders or time-sensitive tasks mentioned

For speaker detection:
- Analyze conversation patterns, topic changes, and speaking styles
- Return the detected speaker count as "detected_speakers": number
- If you detect N speakers, structure insights for SPEAKER 1 through SPEAKER N

For reminders, extract:
- title: Brief description of what needs to be done
- from: Which speaker mentioned it
- due_date_text: EXACTLY what was said about when (e.g., "tomorrow at 2pm", "next Friday", "by end of week"). If NO specific time/date is mentioned, set this to null
- priority: "high", "normal", or "low" based on urgency
- category: "meeting", "call", "task", "deadline", or "personal"
- extracted_from: The exact phrase from the transcript

Return ONLY a valid JSON object with this exact structure:
{
    "detected_speakers": number,
    "speakers": {
        "SPEAKER 1": {
            "action_items": ["list of action items"],
            "key_information": ["list of key points"]
        },
        "SPEAKER 2": {
            "action_items": ["list of action items"],
            "key_information": ["list of key points"]
        }
    },
    "reminders": [
        {
            "title": "string",
            "from": "string",
            "due_date_text": "string or null if no date mentioned",
            "priority": "high/normal/low",
            "category": "meeting/call/task/deadline/personal",
            "extracted_from": "original text"
        }
    ]
}

Important: Only include reminders that have clear action items. Set due_date_text to null if no specific time is mentioned.`;

    logger.info('Extracting insights from transcript');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const insights = JSON.parse(response.choices[0].message.content);
    logger.info('Insights extracted successfully');

    return insights;
  } catch (error) {
    logger.error(`Insight extraction error: ${error.message}`);
    throw new Error(`Insight extraction failed: ${error.message}`);
  }
};