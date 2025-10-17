import express from 'express';
import multer from 'multer';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import { transcriptionLimiter } from '../middleware/rateLimiter.js';
import { transcribeAudio, assignSpeakers, formatTranscript } from '../services/transcriptionService.js';
import { parseDateTimeFromText } from '../services/dateParser.js';
import Transcript from '../models/Transcript.js';
import Reminder from '../models/Reminder.js';
import Task from '../models/Task.js';
import logger from '../utils/logger.js';
import { analyzeMakiConversation } from '../services/makiService.js';
import Conversation from '../models/Conversation.js';
import Person from '../models/Person.js';
import FollowUp from '../models/FollowUp.js';
import { 
  validatePersonProfile, 
  validateRelationship, 
  validateCommunication, 
  validateSentiment,
  validateTaskReminder,
  validateFollowUp 
} from '../utils/schemaValidator.js';




function sanitizeMakiData(analysis) {
  if (!analysis) return null;

  // Helper to safely parse stringified JSON
  const safelyParseJSON = (data, fallback = null) => {
    if (!data) return fallback;
    if (typeof data === 'object' && !Array.isArray(data)) return data;
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') {
      try {
        // Handle single quotes from LLMs - replace them with double quotes
        // But preserve single quotes inside strings
        let normalized = data.trim();
        
        // Remove outer quotes if present
        if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
            (normalized.startsWith("'") && normalized.endsWith("'"))) {
          normalized = normalized.slice(1, -1);
        }
        
        // Replace single quotes with double quotes for JSON parsing
        // This is a simple approach - for production, use a proper JSON5 parser
        normalized = normalized
          .replace(/'/g, '"')
          .replace(/(\w+):/g, '"$1":'); // Add quotes to unquoted keys
        
        return JSON.parse(normalized);
      } catch (e1) {
        // Try without normalization
        try {
          return JSON.parse(data);
        } catch (e2) {
          // If both fail, try eval as last resort (safe in this controlled context)
          try {
            // Only use eval if it looks like valid JavaScript array/object
            if (data.trim().startsWith('[') || data.trim().startsWith('{')) {
              return eval('(' + data + ')');
            }
          } catch (e3) {
            return fallback;
          }
          return fallback;
        }
      }
    }
    return fallback;
  };

  // Helper to ensure array
  const ensureArray = (data, fallback = []) => {
    if (Array.isArray(data)) return data;
    if (!data) return fallback;
    // Try parsing if it's a string
    if (typeof data === 'string') {
      const parsed = safelyParseJSON(data, null);
      if (Array.isArray(parsed)) return parsed;
      // If it's still a string, try to split by common delimiters
      if (typeof parsed === 'string') {
        return [parsed]; // Wrap single string in array
      }
    }
    return [data];
  };

  // Helper to ensure string
  const ensureString = (data, fallback = '') => {
    if (typeof data === 'string') return data;
    if (!data) return fallback;
    return String(data);
  };

  // Sanitize speakers
  if (analysis.speakers) {
    analysis.speakers = analysis.speakers.map(speaker => {
      if (!speaker.profile) return speaker;

      // Sanitize key_info
      if (speaker.profile.key_info) {
        const keyInfo = speaker.profile.key_info;
        
        keyInfo.hobbies = ensureArray(keyInfo.hobbies);
        keyInfo.interests = ensureArray(keyInfo.interests);
        keyInfo.travel = ensureArray(keyInfo.travel);
        
        if (keyInfo.favorites) {
          keyInfo.favorites.movies = ensureArray(keyInfo.favorites.movies);
          keyInfo.favorites.music = ensureArray(keyInfo.favorites.music);
          keyInfo.favorites.books = ensureArray(keyInfo.favorites.books);
          keyInfo.favorites.food = ensureArray(keyInfo.favorites.food);
        }
        
        if (keyInfo.personal_info) {
          keyInfo.personal_info.relatives = ensureArray(keyInfo.personal_info.relatives);
          keyInfo.personal_info.pets = ensureArray(keyInfo.personal_info.pets);
          keyInfo.personal_info.location = ensureArray(keyInfo.personal_info.location);
          keyInfo.personal_info.birthdate = ensureString(keyInfo.personal_info.birthdate, null);
        }
      }

      // Sanitize important_dates - CRITICAL FIX
      if (speaker.profile.important_dates) {
        // First parse if it's a stringified array
        let dates = safelyParseJSON(speaker.profile.important_dates, []);
        
        // Ensure it's an array
        dates = ensureArray(dates);
        
        // Now sanitize each date object
        speaker.profile.important_dates = dates.map(dateObj => {
          if (typeof dateObj === 'string') {
            // If it's just a string, create minimal object
            return {
              date: dateObj,
              description: '',
              type: 'other'
            };
          }
          if (typeof dateObj !== 'object' || dateObj === null) {
            return { date: '', description: '', type: 'other' };
          }
          return {
            date: ensureString(dateObj.date, ''),
            description: ensureString(dateObj.description, ''),
            type: ensureString(dateObj.type, 'other')
          };
        }).filter(dateObj => dateObj.date); // Remove empty dates
      } else {
        // Initialize as empty array if not present
        speaker.profile.important_dates = [];
      }

      // Sanitize common_topics
      if (speaker.profile.common_topics) {
        let topics = safelyParseJSON(speaker.profile.common_topics, []);
        topics = ensureArray(topics);
        
        speaker.profile.common_topics = topics.map(topic => {
          if (typeof topic === 'string') {
            return { topic, frequency: 1 };
          }
          return {
            topic: ensureString(topic.topic, ''),
            frequency: Number(topic.frequency) || 1
          };
        }).filter(topic => topic.topic); // Remove empty topics
      } else {
        speaker.profile.common_topics = [];
      }

      return speaker;
    });
  }

  return analysis;
}


const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

async function processMakiAnalysis(transcriptId, transcript, userId, accountName) {
  try {
    logger.info('Starting MAKI analysis...');
    
    // STEP 1: Get basic conversation data
    let analysis = await analyzeMakiConversation(transcript, accountName);
    
    if (!analysis || !analysis.conversation_metadata) {
      throw new Error('MAKI analysis returned invalid data');
    }

    const results = {
      conversation: null,
      people: [],
      tasks: [],
      reminders: [],
      followups: []
    };

    // Create conversation
    const conversationData = {
      userId,
      transcriptId,
      title: analysis.conversation_metadata.title || 'Untitled Conversation',
      summary: {
        short: analysis.conversation_metadata.summary?.short || '',
        extended: analysis.conversation_metadata.summary?.extended || ''
      },
      conversationDate: new Date(),
      duration: Number(analysis.conversation_metadata.duration_minutes) || 0,
      tags: Array.isArray(analysis.conversation_metadata.tags) ? analysis.conversation_metadata.tags : [],
      participants: [],
      actionItems: [],
      pendingFollowups: [],
      processingStatus: 'completed',
    };

    // Add user to participants
    const userSpeaker = analysis.speakers?.find(s => s.is_user);
    if (userSpeaker) {
      conversationData.participants.push({
        speakerLabel: userSpeaker.speaker_label || 'SPEAKER 1',
        name: accountName,
        isUser: true,
      });
    }

    // Collect non-user speakers
    const nonUserSpeakers = (analysis.speakers || [])
      .filter(s => !s.is_user && s.name && s.name !== 'Unknown')
      .map(s => s.name);

    // STEP 2: Extract detailed profiles
    let personProfiles = { profiles: [] };
    if (nonUserSpeakers.length > 0) {
      try {
        personProfiles = await extractPersonProfiles(transcript, nonUserSpeakers);
      } catch (profileError) {
        logger.error('Profile extraction failed:', profileError.message);
      }
    }

    // Process non-user speakers
    for (const speaker of analysis.speakers || []) {
      if (speaker.is_user) continue;
      if (!speaker.name || speaker.name === 'Unknown') continue;

      // Find matching profile
      const profile = personProfiles.profiles?.find(p => 
        p.name.toLowerCase() === speaker.name.toLowerCase()
      );

      // Find or create Person
      let person = await Person.findOne({
        userId,
        name: { $regex: new RegExp(`^${speaker.name}$`, 'i') },
      });

      if (!person) {
        //  CREATE WITH VALIDATED DATA
        person = await Person.create({
          userId,
          name: speaker.name,
          initials: speaker.name.charAt(0).toUpperCase(),
          relationship: validateRelationship(profile?.relationship),
          communication: validateCommunication({
            lastContacted: new Date(),
            frequency: profile?.communication?.frequency || 'rarely',
            totalConversations: 1,
            conversationCounter: 1,
          }),
          sentiment: validateSentiment(profile?.sentiment),
          profile: validatePersonProfile(profile),
        });
        logger.info(`Created new person: ${person.name}`);
      } else {
        //  UPDATE WITH VALIDATED DATA
        person.communication.lastContacted = new Date();
        person.communication.totalConversations += 1;
        person.communication.conversationCounter += 1;

        // Merge profile data
        if (profile) {
          const validatedProfile = validatePersonProfile(profile);
          
          // Merge arrays without duplicates
          const mergeArrays = (existing = [], incoming = []) => {
            return [...new Set([...existing, ...incoming])];
          };

          person.profile.keyInfo = {
            hobbies: mergeArrays(person.profile.keyInfo?.hobbies, validatedProfile.keyInfo.hobbies),
            interests: mergeArrays(person.profile.keyInfo?.interests, validatedProfile.keyInfo.interests),
            favorites: {
              movies: mergeArrays(person.profile.keyInfo?.favorites?.movies, validatedProfile.keyInfo.favorites.movies),
              music: mergeArrays(person.profile.keyInfo?.favorites?.music, validatedProfile.keyInfo.favorites.music),
              books: mergeArrays(person.profile.keyInfo?.favorites?.books, validatedProfile.keyInfo.favorites.books),
              food: mergeArrays(person.profile.keyInfo?.favorites?.food, validatedProfile.keyInfo.favorites.food),
            },
            travel: mergeArrays(person.profile.keyInfo?.travel, validatedProfile.keyInfo.travel),
            workInfo: validatedProfile.keyInfo.workInfo.company ? validatedProfile.keyInfo.workInfo : person.profile.keyInfo?.workInfo,
            personalInfo: {
              relatives: mergeArrays(person.profile.keyInfo?.personalInfo?.relatives, validatedProfile.keyInfo.personalInfo.relatives),
              pets: mergeArrays(person.profile.keyInfo?.personalInfo?.pets, validatedProfile.keyInfo.personalInfo.pets),
              location: mergeArrays(person.profile.keyInfo?.personalInfo?.location, validatedProfile.keyInfo.personalInfo.location),
              birthdate: validatedProfile.keyInfo.personalInfo.birthdate || person.profile.keyInfo?.personalInfo?.birthdate,
            },
          };
        }
        
        await person.save();
        logger.info(`Updated person: ${person.name}`);
      }

      results.people.push(person);

      conversationData.participants.push({
        personId: person._id,
        speakerLabel: speaker.speaker_label || 'SPEAKER',
        name: person.name,
        isUser: false,
      });
    }

    // Store action items
    if (Array.isArray(analysis.action_items)) {
      conversationData.actionItems = analysis.action_items.map(item => ({
        description: item?.description || '',
        assignedTo: item?.assigned_to || '',
        speaker: item?.from_speaker || '',
        completed: false,
      }));
    }

    // Create conversation
    const conversation = await Conversation.create(conversationData);
    results.conversation = conversation;
    logger.info(`Created conversation: ${conversation.title}`);

    //  CREATE TASKS WITH VALIDATION
    if (Array.isArray(analysis.tasks) && analysis.tasks.length > 0) {
      const taskDocs = analysis.tasks.map((task) => {
        const validated = validateTaskReminder(task);
        return {
          transcriptId,
          userId,
          filename: conversation.title,
          title: validated.title,
          from: validated.from,
          dueDate: validated.dueDateText ? parseDateTimeFromText(validated.dueDateText) : null,
          dueDateText: validated.dueDateText,
          priority: validated.priority,
          category: 'task',
          extractedFrom: validated.extractedFrom,
          completed: false,
        };
      });
      
      const createdTasks = await Task.insertMany(taskDocs);
      results.tasks = createdTasks;
      logger.info(`Created ${createdTasks.length} tasks`);
    }

    //  CREATE REMINDERS WITH VALIDATION
    if (Array.isArray(analysis.reminders) && analysis.reminders.length > 0) {
      const reminderDocs = analysis.reminders.map((reminder) => {
        const validated = validateTaskReminder(reminder);
        return {
          transcriptId,
          userId,
          filename: conversation.title,
          title: validated.title,
          from: validated.from,
          dueDate: validated.dueDateText ? parseDateTimeFromText(validated.dueDateText) : null,
          dueDateText: validated.dueDateText,
          priority: validated.priority,
          category: validated.category,
          extractedFrom: validated.extractedFrom,
          completed: false,
        };
      });
      
      const createdReminders = await Reminder.insertMany(reminderDocs);
      results.reminders = createdReminders;
      logger.info(`Created ${createdReminders.length} reminders`);
    }

    //  CREATE FOLLOW-UPS WITH VALIDATION
    if (Array.isArray(analysis.pending_followups) && analysis.pending_followups.length > 0) {
      const followUpDocs = [];
      
      for (const followup of analysis.pending_followups) {
        const validated = validateFollowUp(followup);
        
        let person = await Person.findOne({
          userId,
          name: { $regex: new RegExp(`^${validated.person}$`, 'i') },
        });
        
        // Create person if not exists
        if (!person) {
          person = await Person.create({
            userId,
            name: validated.person,
            initials: validated.person.charAt(0).toUpperCase(),
            relationship: { type: 'acquaintance' },
            communication: {
              frequency: 'rarely',
              totalConversations: 0,
              conversationCounter: 0,
            },
            sentiment: {
              closenessScore: 0.5,
              tone: 'neutral',
            },
          });
        }
        
        followUpDocs.push({
          userId,
          personId: person._id,
          conversationId: conversation._id,
          type: 'pending',
          priority: validated.priority,
          context: validated.description,
        });
      }
      
      if (followUpDocs.length > 0) {
        const createdFollowUps = await FollowUp.insertMany(followUpDocs);
        results.followups = createdFollowUps;
        logger.info(`Created ${followUpDocs.length} pending follow-ups`);
      }
    }

    logger.info('MAKI processing completed successfully:', {
      conversation: results.conversation?._id,
      people: results.people.length,
      tasks: results.tasks.length,
      reminders: results.reminders.length,
      followups: results.followups.length
    });

    return results;
  } catch (error) {
    logger.error(`MAKI processing error: ${error.message}`);
    logger.error('Stack trace:', error.stack);
    throw error;
  }
}


router.post(
  '/',
  authenticateUser,
  syncUserToDatabase,
  transcriptionLimiter,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const numSpeakers = parseInt(req.body.num_speakers) || 2;
      logger.info(`Processing transcription for user: ${req.user._id}, file: ${req.file.originalname}`);

      // Step 1: Transcribe audio
      const transcriptionResult = await transcribeAudio(req.file.buffer, req.file.originalname);
      
      let segments = transcriptionResult.segments || [];
      segments = assignSpeakers(segments, numSpeakers);
      const finalTranscript = formatTranscript(segments);

      // Step 2: Create transcript record
      const transcript = await Transcript.create({
        userId: req.user._id,
        filename: req.file.originalname,
        numSpeakers: numSpeakers,
        transcript: finalTranscript,
      });

      // Step 3: Process with MAKI (this extracts EVERYTHING)
      let makiAnalysis = null;
      try {
        const accountName = req.user.firstName 
          ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() 
          : req.user.email;
        
        makiAnalysis = await processMakiAnalysis(
          transcript._id,
          finalTranscript,
          req.user._id,
          accountName
        );
        
        logger.info('MAKI processing completed successfully');
      } catch (makiError) {
        logger.error('MAKI processing failed:', makiError.message);
        // Return error to user instead of silently failing
        return res.status(500).json({
          error: 'Failed to process conversation intelligence',
          details: makiError.message,
          transcript: finalTranscript
        });
      }

      // Step 4: Return response with summary
      res.status(200).json({
        success: true,
        message: 'Audio processed successfully',
        transcript: finalTranscript,
        conversation: {
          id: makiAnalysis?.conversation?._id,
          title: makiAnalysis?.conversation?.title,
          summary: makiAnalysis?.conversation?.summary,
          participants: makiAnalysis?.conversation?.participants || [], //  Correct path
        },
        extracted: {
          tasks: makiAnalysis?.tasks?.length || 0,
          reminders: makiAnalysis?.reminders?.length || 0,
          people: makiAnalysis?.people?.map(person => ({
            id: person._id,
            name: person.name,
            initials: person.initials,
            relationship: person.relationship
          })) || [], 
          followups: makiAnalysis?.followups?.length || 0,
        }
      });

    } catch (error) {
      logger.error('Transcription error:', error);
      next(error);
    }
  }
);

router.get('/', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const transcripts = await Transcript.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-insights');

    res.status(200).json(transcripts);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticateUser, syncUserToDatabase, async (req, res, next) => {
  try {
    const transcript = await Transcript.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.status(200).json(transcript);
  } catch (error) {
    next(error);
  }
});

export default router;