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


async function processMakiAnalysis(transcriptId, transcript, userId, user) {
  try {
    const accountName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.email;
    
    // Run MAKI analysis
    const analysis = await analyzeMakiConversation(transcript, accountName);
    
    // Create or update conversation
    const conversationData = {
      userId,
      transcriptId,
      title: analysis.conversation_metadata.title,
      summary: analysis.conversation_metadata.summary,
      conversationDate: new Date(),
      duration: analysis.conversation_metadata.duration_minutes,
      tags: analysis.conversation_metadata.tags || [],
      participants: [],
      actionItems: analysis.action_items || [],
      pendingFollowups: analysis.pending_followups || [],
      processingStatus: 'completed',
    };

    // Process speakers and create/update Person profiles
    for (const speaker of analysis.speakers) {
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
        // Create new person
        person = await Person.create({
          userId,
          name: speaker.name,
          initials: speaker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          relationship: speaker.profile.relationship || {},
          communication: {
            lastContacted: new Date(),
            frequency: speaker.profile.communication?.frequency || 'rarely',
            totalConversations: 1,
            conversationCounter: 1,
          },
          sentiment: speaker.profile.sentiment || {
            closenessScore: 0.5,
            tone: 'neutral',
          },
          profile: {
            summary: speaker.profile.summary,
            keyInfo: speaker.profile.key_info || {},
            commonTopics: speaker.profile.common_topics || [],
            importantDates: speaker.profile.important_dates || [],
          },
        });
      } else {
        // Update existing person
        person.communication.lastContacted = new Date();
        person.communication.totalConversations += 1;
        person.communication.conversationCounter += 1;
        
        // Merge profile data
        if (speaker.profile.summary) {
          person.profile.summary = speaker.profile.summary;
        }
        if (speaker.profile.sentiment) {
          person.sentiment = {
            ...person.sentiment,
            ...speaker.profile.sentiment,
            lastAssessment: new Date(),
          };
        }
        
        // Merge key info
        if (speaker.profile.key_info) {
          const mergeArrays = (existing = [], newItems = []) => {
            return [...new Set([...existing, ...newItems])];
          };
          
          const keyInfo = speaker.profile.key_info;
          person.profile.keyInfo = {
            hobbies: mergeArrays(person.profile.keyInfo.hobbies, keyInfo.hobbies),
            interests: mergeArrays(person.profile.keyInfo.interests, keyInfo.interests),
            favorites: {
              movies: mergeArrays(person.profile.keyInfo.favorites?.movies, keyInfo.favorites?.movies),
              music: mergeArrays(person.profile.keyInfo.favorites?.music, keyInfo.favorites?.music),
              books: mergeArrays(person.profile.keyInfo.favorites?.books, keyInfo.favorites?.books),
              food: mergeArrays(person.profile.keyInfo.favorites?.food, keyInfo.favorites?.food),
            },
            travel: mergeArrays(person.profile.keyInfo.travel, keyInfo.travel),
            workInfo: keyInfo.work_info || person.profile.keyInfo.workInfo,
            personalInfo: {
              relatives: mergeArrays(person.profile.keyInfo.personalInfo?.relatives, keyInfo.personal_info?.relatives),
              pets: mergeArrays(person.profile.keyInfo.personalInfo?.pets, keyInfo.personal_info?.pets),
              location: keyInfo.personal_info?.location || person.profile.keyInfo.personalInfo?.location,
            },
          };
        }
        
        await person.save();
      }

      conversationData.participants.push({
        personId: person._id,
        speakerLabel: speaker.speaker_label,
        name: person.name,
        isUser: false,
      });
    }

    // Create conversation
    const conversation = await Conversation.create(conversationData);

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
        await FollowUp.insertMany(followUpDocs);
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
        await FollowUp.insertMany(followUpDocs);
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
          // Add connection if it doesn't exist
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
          }
        }
      }
    }

    return conversation;
  } catch (error) {
    logger.error(`MAKI processing error: ${error.message}`);
    throw error;
  }
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

      const transcriptionResult = await transcribeAudio(req.file.buffer, req.file.originalname);
      
      let segments = transcriptionResult.segments || [];
      segments = assignSpeakers(segments, numSpeakers);

      const finalTranscript = formatTranscript(segments);

      const insights = await extractInsights(finalTranscript);

      const transcript = await Transcript.create({
        userId: req.user._id,
        filename: req.file.originalname,
        numSpeakers: insights.detected_speakers || numSpeakers,
        transcript: finalTranscript,
        insights: insights.speakers || {},
      });

     if (insights.reminders && insights.reminders.length > 0) {
          
          const taskCategories = ['task', 'deadline'];
          const reminderCategories = ['meeting', 'call', 'personal'];
          
          const tasks = insights.reminders.filter(item => 
            taskCategories.includes(item.category)
          );
          
          const reminders = insights.reminders.filter(item => 
            reminderCategories.includes(item.category)
          );
          
          
          if (tasks.length > 0) {
            const taskDocs = tasks.map((task) => ({
              transcriptId: transcript._id,
              userId: req.user._id,
              filename: req.file.originalname,
              title: task.title,
              from: task.from,
              dueDate: task.due_date_text ? parseDateTimeFromText(task.due_date_text) : null,
              dueDateText: task.due_date_text,
              priority: task.priority,
              category: task.category,
              extractedFrom: task.extracted_from,
              completed: false,
            }));
            
            await Task.insertMany(taskDocs);
            logger.info(`Created ${taskDocs.length} tasks for user: ${req.user._id}`);
          }
          
          
          if (reminders.length > 0) {
            const reminderDocs = reminders.map((reminder) => ({
              transcriptId: transcript._id,
              userId: req.user._id,
              filename: req.file.originalname,
              title: reminder.title,
              from: reminder.from,
              dueDate: reminder.due_date_text ? parseDateTimeFromText(reminder.due_date_text) : null,
              dueDateText: reminder.due_date_text,
              priority: reminder.priority,
              category: reminder.category,
              extractedFrom: reminder.extracted_from,
              completed: false,
            }));
            
            await Reminder.insertMany(reminderDocs);
            logger.info(`Created ${reminderDocs.length} reminders for user: ${req.user._id}`);
          }
        }

         try {
              await processMakiAnalysis(
                transcript._id,
                finalTranscript,
                req.user._id,
                req.user
              );
              logger.info('MAKI processing completed for transcript:', transcript._id);
        } catch (makiError) {
            logger.error('MAKI processing failed:', makiError.message);
        }

      res.status(200).json({
        transcript: finalTranscript,
        insights: insights.speakers || {},
        reminders: insights.reminders || [],
        detected_speakers: insights.detected_speakers,
      });

    } catch (error) {
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