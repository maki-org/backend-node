import { getGroqClient } from '../config/groq.js';
import logger from '../utils/logger.js';

export const analyzeMakiConversation = async (transcript, accountName) => {
  try {
    const groq = getGroqClient();

    const prompt = `System role: Active Listening Agent (Codename: MAKI)
You are an intelligent transcription and conversation-analysis system.
Your goal is to convert a raw multi-speaker transcript into structured conversational intelligence.

Account Name: ${accountName}

Conversation Transcript:
${transcript}

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no explanations.

Perform the following analysis and return a valid JSON object:

1. **Identify Speakers**: Detect all unique speakers. If a name is explicitly mentioned, use it. If the first speaker matches the account name, mark "is_user": true.

2. **Extract Structured Data**:
   - title: Short descriptive title (5-8 words)
   - summary: { short: "one-line summary", extended: "five-line detailed summary" }
   - action_items: [{description, assigned_to, from_speaker, extracted_from}]
   - reminders: [{title, from, due_date_text, priority, category, extracted_from}]
   - pending_followups: [{description, person, extracted_from, priority}]

3. **Build Personal Intelligence Profile for EACH non-user speaker**:
   - Extract name, relationship, communication frequency
   - Extract hobbies, interests, favorites, work info
   - IMPORTANT: For dates, ONLY use ISO format strings like "2025-12-15" or descriptive text like "December 2025"
   - IMPORTANT: location must be an array of strings like ["New York", "Tokyo"]

Return ONLY valid JSON with this EXACT structure:

{
  "conversation_metadata": {
    "title": "string",
    "summary": {
      "short": "string",
      "extended": "string"
    },
    "duration_minutes": 30,
    "tags": ["meeting", "work"],
    "detected_speakers": 2
  },
  "speakers": [
    {
      "speaker_label": "SPEAKER 1",
      "name": "John Doe",
      "is_user": true,
      "profile": {
        "relationship": {
          "type": "colleague",
          "subtype": "manager",
          "source": "workplace"
        },
        "communication": {
          "frequency": "weekly"
        },
        "sentiment": {
          "closenessScore": 0.8,
          "tone": "professional"
        },
        "summary": "Brief profile summary",
        "key_info": {
          "hobbies": ["hiking", "photography"],
          "interests": ["AI", "technology"],
          "favorites": {
            "movies": ["Inception"],
            "music": ["Jazz"],
            "books": ["1984"],
            "food": ["Italian"]
          },
          "travel": ["Japan", "Europe"],
          "work_info": {
            "company": "TechCorp",
            "position": "Engineer",
            "industry": "Technology"
          },
          "personal_info": {
            "relatives": ["brother Alex"],
            "pets": ["dog named Max"],
            "birthdate": "March 15",
            "location": ["San Francisco", "New York"]
          }
        },
        "common_topics": [
          {
            "topic": "project planning",
            "frequency": 5
          }
        ],
        "important_dates": [
          {
            "date": "2025-12-15",
            "description": "Conference in Tokyo",
            "type": "travel"
          }
        ]
      }
    }
  ],
  "action_items": [
    {
      "description": "Review document",
      "assigned_to": "Sarah",
      "from_speaker": "SPEAKER 1",
      "extracted_from": "I need you to review..."
    }
  ],
  "reminders": [
    {
      "title": "Client meeting",
      "from": "SPEAKER 1",
      "due_date_text": "Friday 2 PM",
      "priority": "high",
      "category": "meeting",
      "extracted_from": "We have a meeting..."
    }
  ],
  "pending_followups": [
    {
      "description": "Call Mike from TechCorp",
      "person": "Mike",
      "extracted_from": "I need to follow up...",
      "priority": "medium"
    }
  ],
  "suggested_followups": [
    {
      "person": "Lisa",
      "reason": "Haven't talked in a while",
      "priority": "low"
    }
  ],
  "network_connections": [
    {
      "person1": "Sarah",
      "person2": "Alex",
      "relationship_type": "siblings",
      "strength": 0.9
    }
  ]
}

CRITICAL RULES:
1. Return ONLY the JSON object, no extra text
2. All dates must be strings in ISO format (YYYY-MM-DD) or descriptive text
3. important_dates must be array of objects with date/description/type as strings
4. location must be array of strings
5. All arrays must contain proper objects or strings, not stringified JSON
6. Do not wrap JSON in code blocks or markdown`;

    logger.info('Starting MAKI conversation analysis');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 8000,
    });

    let analysis;
    try {
      analysis = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      logger.error('Failed to parse MAKI response:', response.choices[0].message.content);
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