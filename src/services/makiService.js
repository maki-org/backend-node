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

Perform the following analysis and return a valid JSON object:

1. **Identify Speakers**: Detect all unique speakers. If a name is explicitly mentioned, use it. If the first speaker matches the account name, mark "is_user": true. Maintain a "conversation_counter" for repeat interactions.

2. **Extract Structured Data**:
   - title: Short descriptive title (5-8 words)
   - summary: { short: "one-line summary", extended: "five-line detailed summary" }
   - action_items: [{description, assigned_to, from_speaker, extracted_from}]
   - reminders: [{title, from, due_date_text, priority, category, extracted_from}]
   - pending_followups: [{description, person, extracted_from, priority}]
   - suggested_followups: Based on conversation warmth and relationship strength

3. **Build Personal Intelligence Profile for EACH non-user speaker**:
   - name: Extracted or inferred name
   - relationship: {type, subtype, source}
   - communication: {frequency: "daily/weekly/monthly/quarterly/yearly/rarely"}
   - sentiment: {closeness_score: 0-1, tone: "warm/neutral/formal/casual/professional"}
   - summary: Brief profile of this person based on the conversation
   - key_info: {
       hobbies: [],
       interests: [],
       favorites: {movies: [], music: [], books: [], food: []},
       travel: [],
       work_info: {company, position, industry},
       personal_info: {relatives: [], pets: [], location: []}
     }
   - common_topics: [{topic, frequency}]
   - important_dates: [{date, description, type}]

4. **Network Analysis**:
   - connections: [{person1, person2, relationship_type, strength: 0-1}]

Return ONLY valid JSON with this structure:
{
  "conversation_metadata": {
    "title": "string",
    "summary": {"short": "string", "extended": "string"},
    "duration_minutes": number,
    "tags": ["string"],
    "detected_speakers": number
  },
  "speakers": [
    {
      "speaker_label": "SPEAKER 1",
      "name": "string or null",
      "is_user": boolean,
      "profile": {
        // Full personal intelligence profile as specified above
      }
    }
  ],
  "action_items": [],
  "reminders": [],
  "pending_followups": [],
  "suggested_followups": [
    {"person": "string", "reason": "string", "priority": "high/medium/low"}
  ],
  "network_connections": []
}

IMPORTANT: Only include information explicitly mentioned or strongly implied in the conversation. Use null for unknown fields.`;

    logger.info('Starting MAKI conversation analysis');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
      max_tokens: 8000,
    });

    const analysis = JSON.parse(response.choices[0].message.content);
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