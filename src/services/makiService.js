import { getGroqClient } from '../config/groq.js';
import logger from '../utils/logger.js';

export const analyzeMakiConversation = async (transcript, accountName) => {
  try {
    const groq = getGroqClient();

    const prompt = `You are an AI conversation analyzer. Extract key information from this transcript.
    
Account Name: ${accountName}

Transcript:
${transcript}

CRITICAL: Return ONLY valid JSON. NO markdown, NO explanations, NO code blocks.

Extract and return this EXACT JSON structure:

{
  "conversation_metadata": {
    "title": "Brief title (5-8 words)",
    "summary": {
      "short": "One sentence",
      "extended": "2-3 sentences max"
    },
    "duration_minutes": 30,
    "tags": ["meeting", "work"],
    "detected_speakers": 2
  },
  "speakers": [
    {
      "speaker_label": "SPEAKER 1",
      "name": "Name or Unknown",
      "is_user": true/false,
      "profile": {
        "relationship": {
          "type": "colleague/friend/family/client/other",
          "subtype": "team member",
          "source": "workplace"
        },
        "communication": {
          "frequency": "daily/weekly/monthly/quarterly/yearly/rarely"
        },
        "sentiment": {
          "closenessScore": 0.7,
          "tone": "professional/warm/neutral/formal/casual"
        },
        "summary": "One sentence about this person",
        "key_info": {
          "hobbies": [],
          "interests": ["AI"],
          "favorites": {
            "movies": [],
            "music": [],
            "books": [],
            "food": ["Italian"]
          },
          "travel": [],
          "work_info": {
            "company": "",
            "position": "",
            "industry": ""
          },
          "personal_info": {
            "relatives": [],
            "pets": [],
            "birthdate": "",
            "location": []
          }
        },
        "common_topics": [],
        "important_dates": []
      }
    }
  ],
  "action_items": [
    {
      "description": "Brief description",
      "assigned_to": "Person name",
      "from_speaker": "SPEAKER 1",
      "extracted_from": "Quote from transcript"
    }
  ],
  "tasks": [
    {
      "title": "Task title",
      "from": "SPEAKER 1",
      "due_date_text": "Thursday/Friday afternoon/next week",
      "priority": "high/medium/low",
      "extracted_from": "Quote"
    }
  ],
  "reminders": [
    {
      "title": "Reminder title",
      "from": "SPEAKER 1",
      "due_date_text": "Friday at 2 PM",
      "priority": "high/medium/low",
      "category": "meeting/call/personal",
      "extracted_from": "Quote"
    }
  ],
  "pending_followups": [
    {
      "description": "Follow up description",
      "person": "Person name",
      "extracted_from": "Quote",
      "priority": "high/medium/low"
    }
  ],
  "suggested_followups": [],
  "network_connections": []
}

RULES:
1. Use DOUBLE QUOTES only
2. Keep descriptions brief
3. Don't extract empty data - use [] for empty arrays
4. All dates as text strings like "Thursday", "Friday at 2 PM", "next week"
5. Extract only CLEAR, EXPLICIT information from transcript
6. Return COMPLETE, VALID JSON`;

    logger.info('Starting MAKI conversation analysis');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 16000, // Increased
    });

    let analysis;
    try {
      const rawResponse = response.choices[0].message.content;
      logger.info('Raw MAKI response length:', rawResponse.length);
      
      // Clean up response
      let cleanedResponse = rawResponse
        .trim()
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^[^{]*({.*})[^}]*$/s, '$1'); // Extract only JSON object
      
      analysis = JSON.parse(cleanedResponse);
    } catch (parseError) {
      logger.error('Failed to parse MAKI response');
      logger.error('Response preview:', response.choices[0].message.content.substring(0, 500));
      logger.error('Response end:', response.choices[0].message.content.substring(response.choices[0].message.content.length - 200));
      throw new Error('MAKI returned invalid JSON');
    }

    logger.info('MAKI analysis completed successfully');
    return analysis;
  } catch (error) {
    logger.error(`MAKI analysis error: ${error.message}`);
    throw new Error(`MAKI analysis failed: ${error.message}`);
  }
};

export const calculateSuggestedFollowUps = async (userId, Person) => {
  try {
    const now = new Date();
    const suggestions = [];

    const people = await Person.find({ userId });

    for (const person of people) {
      if (!person.communication.lastContacted) continue;

      const daysSinceContact = Math.floor(
        (now - person.communication.lastContacted) / (1000 * 60 * 60 * 24)
      );

      const frequencyThresholds = {
        daily: 2,
        weekly: 10,
        monthly: 35,
        quarterly: 100,
        yearly: 400,
        rarely: 730,
      };

      const threshold = frequencyThresholds[person.communication.frequency] || 30;

      if (daysSinceContact > threshold) {
        suggestions.push({
          person: person.name,
          personId: person._id,
          reason: `You haven't connected with ${person.name} in ${daysSinceContact} days. You usually talk ${person.communication.frequency}.`,
          priority: daysSinceContact > threshold * 2 ? 'high' : 'medium',
        });
      }
    }

    return suggestions;
  } catch (error) {
    logger.error(`Error calculating suggested follow-ups: ${error.message}`);
    return [];
  }
};