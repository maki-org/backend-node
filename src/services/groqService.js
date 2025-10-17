import { getGroqClient } from '../config/groq.js';
import logger from '../utils/logger.js';

export const extractInsights = async (transcript) => {
  try {
    const groq = getGroqClient();

    const prompt = `You are an intelligent transcription and conversation-analysis system called MAKI.




Your goal is to convert a raw multi-speaker conversation into structured conversational intelligence.

You will receive a transcript or diarized conversation between two or more speakers.  
Perform the following steps carefully and return a valid JSON object conforming exactly to the schema below.

Transcript:
${transcript}

---

1. Identify speakers.
   - Detect all unique voices or names in the dialogue.
   - If a name is explicitly mentioned (e.g., “Hey Viswajit”), assign that name to the speaker.
   - If no name is found, assume the first person to speak is the **user**, unless metadata specifies otherwise.
   - If the name of a converser matches the account name in metadata, mark \"is_user\": true.
   - \"Maintain\" a \"conversation_counter\" for how many times this person has been spoken to before.

2. Extract structured data.
   - **Title:** Generate a short, descriptive title summarizing the conversation.
   - **Summary:** Create two summaries — one short one-liner and one extended five-liner.
   - **Transcript:** Clean, labeled text (e.g., “DEV:” / “VISW:”).
   - **Action Items:** Any concrete commitments or to-dos (e.g., “I’ll send the file tomorrow”).
   - **Reminders:** Any time-bound events or mentions (“meeting at 5 PM”).
   - **Pending Followups:** Any mention of “I need to call”, “I need to follow up”, “remind me to”, etc.
   - **Suggested Followups:** Based on the user’s known contacts or context, recommend who to reconnect with.

3. Build the Personal Intelligence Profile for each converser.
   For every person (except the user):
   - Role / relationship (friend, client, colleague, investor, etc.)
   - Context of acquaintance (workplace, event, etc.)
   - Last contacted date (if extractable)
   - Communication frequency (daily, weekly, rarely, etc.)
   - Sentiment or closeness (scale 0–1 based on warmth and tone)
   - Summary of the person
   - Key information:
       • Hobbies
       • Names of close ones
       • Favorite movies or music
       • Places of interest
       • General interests

   Infer these when implicit cues are present (e.g., “We should grab coffee again” → friend relationship).

4. Output only JSON. No explanation, no additional commentary.

---

Return the final output strictly following this JSON schema:

{
  "conversation": {
    "conversation_id": "<uuid>",
    "title": "Catch-up with Viswajit about the new AI module",
    "summary": {
      "short": "Discussion about MAKI’s new transcription module.",
      "extended": "Dev and Viswajit discuss improving the transcription module using Whisper v3 Turbo and Llama 3.3. They cover user-speaker mapping, task extraction, and personal intelligence integration."
    },
    "transcript": [
      {"speaker": "DEV", "text": "Hey Viswajit, did you finish linking the backend?"},
      {"speaker": "VISW", "text": "Almost done, I’ll push the updates tonight."}
    ],
    "action_items": [
      {"task": "Push backend updates to repository", "assignee": "Viswajit", "deadline": null}
    ],
    "reminders": [
      {"event": "Team sync tomorrow at 10 AM", "date": "2025-10-17T10:00:00Z"}
    ],
    "pending_followups": [
      "I need to follow up with Jay regarding the API key."
    ],
    "suggested_followups": [
      {"person_name": "Jay Krishna", "reason": "Recent mention in context of follow-up"}
    ],
    "participants": [
      {
        "name": "Dev Nandan Anoop",
        "is_user": true,
        "conversation_counter": 12
      },
      {
        "name": "Viswajit",
        "is_user": false,
        "conversation_counter": 8
      }
    ]
  },
  "personal_intelligence": [
    {
      "name": "Viswajit",
      "role": "Co-founder / Developer",
      "relationship_context": "Startup Project MAKI",
      "last_contacted": "2025-10-16",
      "communication_frequency": "Daily",
      "sentiment_closeness": 0.85,
      "summary": "Collaborates frequently with Dev on backend integration; appears motivated and aligned with project goals.",
      "key_information": {
        "hobbies": ["coding", "music"],
        "close_relations": [],
        "movies_music": ["Tron Legacy OST"],
        "places_of_interest": ["Technopark Trivandrum"],
        "interests": ["AI tools", "automation"]
      }
    }
  ]
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

---

Important:
- Output **only JSON** matching this format.  
- Ensure logical consistency between transcript, action items, and personal intelligence.  
- Do not invent absurd or unrealistic information — infer only what’s reasonably supported by the conversation.


Important: Only include reminders that have clear action items. Set due_date_text to null if no specific time is mentioned.`;

    logger.info('Extracting insights from transcript');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const insights = JSON.parse(response.choices[0].message.content);
    logger.debug('Insights JSON:', insights);
    logger.info('Insights extracted successfully');

    return insights;
  } catch (error) {
    logger.error(`Insight extraction error: ${error.message}`);
    throw new Error(`Insight extraction failed: ${error.message}`);
  }
};