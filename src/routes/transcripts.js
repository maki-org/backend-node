import express from 'express';
import multer from 'multer';
import { authenticateUser, syncUserToDatabase } from '../middleware/auth.js';
import { transcriptionLimiter } from '../middleware/rateLimiter.js';
import { transcribeAudio, assignSpeakers, formatTranscript } from '../services/transcriptionService.js';
import { extractInsights } from '../services/groqService.js';
import { parseDateTimeFromText } from '../services/dateParser.js';
import Transcript from '../models/Transcript.js';
import Reminder from '../models/Reminder.js';
import Task from '../models/Task.js';
import logger from '../utils/logger.js';
import { analyzeMakiConversation } from '../services/makiService.js';
import Conversation from '../models/Conversation.js';
import Person from '../models/Person.js';
import FollowUp from '../models/FollowUp.js';




function sanitizeMakiData(analysis) {
  if (!analysis) return null;

  // Helper to safely parse stringified JSON
  const safelyParseJSON = (data, fallback = null) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };

  // Helper to ensure array
  const ensureArray = (data, fallback = []) => {
    if (Array.isArray(data)) return data;
    if (!data) return fallback;
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

      // Sanitize important_dates
      if (speaker.profile.important_dates) {
        const dates = safelyParseJSON(speaker.profile.important_dates, []);
        speaker.profile.important_dates = ensureArray(dates).map(dateObj => {
          if (typeof dateObj === 'string') {
            return {
              date: dateObj,
              description: '',
              type: 'other'
            };
          }
          return {
            date: ensureString(dateObj.date, ''),
            description: ensureString(dateObj.description, ''),
            type: ensureString(dateObj.type, 'other')
          };
        });
      }

      // Sanitize common_topics
      if (speaker.profile.common_topics) {
        const topics = safelyParseJSON(speaker.profile.common_topics, []);
        speaker.profile.common_topics = ensureArray(topics).map(topic => {
          if (typeof topic === 'string') {
            return { topic, frequency: 1 };
          }
          return {
            topic: ensureString(topic.topic, ''),
            frequency: Number(topic.frequency) || 1
          };
        });
      }

      if (speaker.profile.important_dates) {
     // First, handle the case where the entire array is a string
     let dates = speaker.profile.important_dates;
     if (typeof dates === 'string') {
       try {
         // LLMs often use single quotes, which is invalid JSON. Replace them.
         dates = JSON.parse(dates.replace(/'/g, '"'));
       } catch {
         // If parsing fails, default to an empty array to prevent crashes
         dates = [];
       }
     }

     // Now, ensure it's an array and map over it to clean each object
     speaker.profile.important_dates = ensureArray(dates).map(dateObj => {
       if (typeof dateObj === 'string') {
         // Handle cases where an element is just a string
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
     });
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
    
    // Run MAKI analysis
    let analysis = await analyzeMakiConversation(transcript, accountName);
    
    if (!analysis || !analysis.conversation_metadata) {
      throw new Error('MAKI analysis returned invalid data');
    }

    // SANITIZE DATA BEFORE PROCESSING
    analysis = sanitizeMakiData(analysis);

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
      title: analysis.conversation_metadata.title,
      summary: analysis.conversation_metadata.summary,
      conversationDate: new Date(),
      duration: analysis.conversation_metadata.duration_minutes,
      tags: analysis.conversation_metadata.tags || [],
      participants: [],
      actionItems: [],
      pendingFollowups: [],
      processingStatus: 'completed',
    };

    // Process speakers and create/update Person profiles
    for (const speaker of analysis.speakers || []) {
      if (speaker.is_user) {
        conversationData.participants.push({
          speakerLabel: speaker.speaker_label,
          name: accountName,
          isUser: true,
        });
        continue;
      }

      if (!speaker.name) continue;

      // Find or create Person
      let person = await Person.findOne({
        userId,
        name: { $regex: new RegExp(`^${speaker.name}$`, 'i') },
      });

      if (!person) {
        // Create new person with sanitized data
        person = await Person.create({
          userId,
          name: speaker.name,
          initials: speaker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          relationship: speaker.profile?.relationship || {},
          communication: {
            lastContacted: new Date(),
            frequency: speaker.profile?.communication?.frequency || 'rarely',
            totalConversations: 1,
            conversationCounter: 1,
          },
          sentiment: speaker.profile?.sentiment || {
            closenessScore: 0.5,
            tone: 'neutral',
          },
          profile: {
            summary: speaker.profile?.summary || '',
            keyInfo: speaker.profile?.key_info || {},
            commonTopics: speaker.profile?.common_topics || [],
            importantDates: speaker.profile?.important_dates || [],
          },
        });
        
        results.people.push(person);
        logger.info(`Created new person: ${person.name}`);
      } else {
        // Update existing person
        person.communication.lastContacted = new Date();
        person.communication.totalConversations += 1;
        person.communication.conversationCounter += 1;
        
        if (speaker.profile?.summary) {
          person.profile.summary = speaker.profile.summary;
        }
        if (speaker.profile?.sentiment) {
          person.sentiment = {
            ...person.sentiment,
            ...speaker.profile.sentiment,
            lastAssessment: new Date(),
          };
        }
        
        // Merge key info with sanitized data
        if (speaker.profile?.key_info) {
          const mergeArrays = (existing = [], newItems = []) => {
            return [...new Set([...existing, ...newItems])];
          };
          
          const keyInfo = speaker.profile.key_info;
          person.profile.keyInfo = {
            hobbies: mergeArrays(person.profile.keyInfo?.hobbies, keyInfo.hobbies),
            interests: mergeArrays(person.profile.keyInfo?.interests, keyInfo.interests),
            favorites: {
              movies: mergeArrays(person.profile.keyInfo?.favorites?.movies, keyInfo.favorites?.movies),
              music: mergeArrays(person.profile.keyInfo?.favorites?.music, keyInfo.favorites?.music),
              books: mergeArrays(person.profile.keyInfo?.favorites?.books, keyInfo.favorites?.books),
              food: mergeArrays(person.profile.keyInfo?.favorites?.food, keyInfo.favorites?.food),
            },
            travel: mergeArrays(person.profile.keyInfo?.travel, keyInfo.travel),
            workInfo: keyInfo.work_info || person.profile.keyInfo?.workInfo,
            personalInfo: {
              relatives: mergeArrays(person.profile.keyInfo?.personalInfo?.relatives, keyInfo.personal_info?.relatives),
              pets: mergeArrays(person.profile.keyInfo?.personalInfo?.pets, keyInfo.personal_info?.pets),
              location: mergeArrays(person.profile.keyInfo?.personalInfo?.location, keyInfo.personal_info?.location),
              birthdate: keyInfo.personal_info?.birthdate || person.profile.keyInfo?.personalInfo?.birthdate,
            },
          };
        }

        // Merge important dates
        if (speaker.profile?.important_dates && Array.isArray(speaker.profile.important_dates)) {
          person.profile.importantDates = [
            ...(person.profile.importantDates || []),
            ...speaker.profile.important_dates
          ];
        }

        // Merge common topics
        if (speaker.profile?.common_topics && Array.isArray(speaker.profile.common_topics)) {
          person.profile.commonTopics = [
            ...(person.profile.commonTopics || []),
            ...speaker.profile.common_topics
          ];
        }
        
        await person.save();
        results.people.push(person);
        logger.info(`Updated person: ${person.name}`);
      }

      conversationData.participants.push({
        personId: person._id,
        speakerLabel: speaker.speaker_label,
        name: person.name,
        isUser: false,
      });
    }

    // Store action items in conversation
    if (analysis.action_items) {
      conversationData.actionItems = analysis.action_items.map(item => ({
        description: item.description || item.task,
        assignedTo: item.assigned_to || item.assignee,
        speaker: item.from_speaker,
        completed: false,
      }));
    }

    // Create conversation
    const conversation = await Conversation.create(conversationData);
    results.conversation = conversation;
    logger.info(`Created conversation: ${conversation.title}`);

    // Extract and create Tasks and Reminders
    if (analysis.reminders && analysis.reminders.length > 0) {
      const taskCategories = ['task', 'deadline'];
      const reminderCategories = ['meeting', 'call', 'personal'];
      
      const tasks = analysis.reminders.filter(item => 
        taskCategories.includes(item.category)
      );
      
      const reminders = analysis.reminders.filter(item => 
        reminderCategories.includes(item.category)
      );
      
      if (tasks.length > 0) {
        const taskDocs = tasks.map((task) => ({
          transcriptId: transcriptId,
          userId: userId,
          filename: conversation.title,
          title: task.title,
          from: task.from,
          dueDate: task.due_date_text ? parseDateTimeFromText(task.due_date_text) : null,
          dueDateText: task.due_date_text,
          priority: task.priority,
          category: task.category,
          extractedFrom: task.extracted_from,
          completed: false,
        }));
        
        const createdTasks = await Task.insertMany(taskDocs);
        results.tasks = createdTasks;
        logger.info(`Created ${taskDocs.length} tasks`);
      }
      
      if (reminders.length > 0) {
        const reminderDocs = reminders.map((reminder) => ({
          transcriptId: transcriptId,
          userId: userId,
          filename: conversation.title,
          title: reminder.title,
          from: reminder.from,
          dueDate: reminder.due_date_text ? parseDateTimeFromText(reminder.due_date_text) : null,
          dueDateText: reminder.due_date_text,
          priority: reminder.priority,
          category: reminder.category,
          extractedFrom: reminder.extracted_from,
          completed: false,
        }));
        
        const createdReminders = await Reminder.insertMany(reminderDocs);
        results.reminders = createdReminders;
        logger.info(`Created ${reminderDocs.length} reminders`);
      }
    }

    // Create pending follow-ups
    if (analysis.pending_followups && analysis.pending_followups.length > 0) {
      const followUpDocs = [];
      
      for (const followup of analysis.pending_followups) {
        const person = await Person.findOne({
          userId,
          name: { $regex: new RegExp(`^${followup.person}$`, 'i') },
        });
        
        if (person) {
          followUpDocs.push({
            userId,
            personId: person._id,
            conversationId: conversation._id,
            type: 'pending',
            priority: followup.priority || 'medium',
            context: followup.description,
          });
        }
      }
      
      if (followUpDocs.length > 0) {
        const createdFollowUps = await FollowUp.insertMany(followUpDocs);
        results.followups = createdFollowUps;
        logger.info(`Created ${followUpDocs.length} pending follow-ups`);
      }
    }

    // Create suggested follow-ups
    if (analysis.suggested_followups && analysis.suggested_followups.length > 0) {
      const followUpDocs = [];
      
      for (const followup of analysis.suggested_followups) {
        const person = await Person.findOne({
          userId,
          name: { $regex: new RegExp(`^${followup.person}$`, 'i') },
        });
        
        if (person) {
          followUpDocs.push({
            userId,
            personId: person._id,
            conversationId: conversation._id,
            type: 'suggested',
            priority: followup.priority || 'medium',
            context: followup.reason,
            reason: followup.reason,
          });
        }
      }
      
      if (followUpDocs.length > 0) {
        const createdSuggested = await FollowUp.insertMany(followUpDocs);
        results.followups.push(...createdSuggested);
        logger.info(`Created ${followUpDocs.length} suggested follow-ups`);
      }
    }

    // Process network connections
    if (analysis.network_connections && analysis.network_connections.length > 0) {
      for (const connection of analysis.network_connections) {
        const person1 = await Person.findOne({
          userId,
          name: { $regex: new RegExp(`^${connection.person1}$`, 'i') },
        });
        
        const person2 = await Person.findOne({
          userId,
          name: { $regex: new RegExp(`^${connection.person2}$`, 'i') },
        });
        
        if (person1 && person2) {
          if (!person1.connections) person1.connections = [];
          
          const hasConnection = person1.connections.some(
            c => c.personId.toString() === person2._id.toString()
          );
          
          if (!hasConnection) {
            person1.connections.push({
              personId: person2._id,
              relationshipType: connection.relationship_type,
              strength: connection.strength || 0.5,
            });
            await person1.save();
            logger.info(`Created connection: ${person1.name} -> ${person2.name}`);
          }
        }
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
          title: makiAnalysis?.conversation?.title,
          summary: makiAnalysis?.conversation?.summary,
          participants: makiAnalysis?.participants?.length || 0,
        },
        extracted: {
          tasks: makiAnalysis?.tasks?.length || 0,
          reminders: makiAnalysis?.reminders?.length || 0,
          people: makiAnalysis?.people?.length || 0,
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