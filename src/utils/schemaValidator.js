// src/utils/schemaValidator.js
import logger from './logger.js';

/**
 * Validates and normalizes person profile data to match the Person schema
 */
export const validatePersonProfile = (profileData) => {
  try {
    return {
      summary: profileData?.summary || '',
      keyInfo: {
        hobbies: Array.isArray(profileData?.key_info?.hobbies) ? profileData.key_info.hobbies : [],
        interests: Array.isArray(profileData?.key_info?.interests) ? profileData.key_info.interests : [],
        favorites: {
          movies: Array.isArray(profileData?.key_info?.favorites?.movies) ? profileData.key_info.favorites.movies : [],
          music: Array.isArray(profileData?.key_info?.favorites?.music) ? profileData.key_info.favorites.music : [],
          books: Array.isArray(profileData?.key_info?.favorites?.books) ? profileData.key_info.favorites.books : [],
          food: Array.isArray(profileData?.key_info?.favorites?.food) ? profileData.key_info.favorites.food : [],
        },
        travel: Array.isArray(profileData?.key_info?.travel) ? profileData.key_info.travel : [],
        workInfo: {
          company: profileData?.key_info?.work_info?.company || '',
          position: profileData?.key_info?.work_info?.position || '',
          industry: profileData?.key_info?.work_info?.industry || '',
        },
        personalInfo: {
          relatives: Array.isArray(profileData?.key_info?.personal_info?.relatives) ? profileData.key_info.personal_info.relatives : [],
          pets: Array.isArray(profileData?.key_info?.personal_info?.pets) ? profileData.key_info.personal_info.pets : [],
          birthdate: profileData?.key_info?.personal_info?.birthdate || '',
          location: Array.isArray(profileData?.key_info?.personal_info?.location) ? profileData.key_info.personal_info.location : [],
        },
      },
      commonTopics: Array.isArray(profileData?.common_topics) 
        ? profileData.common_topics.map(topic => ({
            topic: topic?.topic || '',
            frequency: Number(topic?.frequency) || 1
          }))
        : [],
      importantDates: Array.isArray(profileData?.important_dates)
        ? profileData.important_dates.map(date => ({
            date: date?.date || '',
            description: date?.description || '',
            type: date?.type || 'other'
          }))
        : [],
    };
  } catch (error) {
    logger.error('Profile validation error:', error);
    return {
      summary: '',
      keyInfo: {
        hobbies: [],
        interests: [],
        favorites: { movies: [], music: [], books: [], food: [] },
        travel: [],
        workInfo: { company: '', position: '', industry: '' },
        personalInfo: { relatives: [], pets: [], birthdate: '', location: [] },
      },
      commonTopics: [],
      importantDates: [],
    };
  }
};

/**
 * Validates relationship data
 */
export const validateRelationship = (relationshipData) => {
  const validTypes = ['friend', 'family', 'colleague', 'client', 'investor', 'mentor', 'acquaintance', 'other'];
  
  return {
    type: validTypes.includes(relationshipData?.type) ? relationshipData.type : 'other',
    subtype: relationshipData?.subtype || '',
    source: relationshipData?.source || '',
  };
};

/**
 * Validates communication data
 */
export const validateCommunication = (commData) => {
  const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'rarely'];
  
  return {
    lastContacted: commData?.lastContacted || new Date(),
    frequency: validFrequencies.includes(commData?.frequency) ? commData.frequency : 'rarely',
    totalConversations: Number(commData?.totalConversations) || 0,
    conversationCounter: Number(commData?.conversationCounter) || 0,
  };
};

/**
 * Validates sentiment data
 */
export const validateSentiment = (sentimentData) => {
  const validTones = ['warm', 'neutral', 'formal', 'casual', 'professional'];
  
  let closenessScore = Number(sentimentData?.closenessScore);
  if (isNaN(closenessScore) || closenessScore < 0 || closenessScore > 1) {
    closenessScore = 0.5;
  }
  
  return {
    closenessScore,
    tone: validTones.includes(sentimentData?.tone) ? sentimentData.tone : 'neutral',
  };
};

/**
 * Validates task/reminder data
 */
export const validateTaskReminder = (data) => {
  const validPriorities = ['high', 'medium', 'normal', 'low'];
  const validCategories = ['meeting', 'call', 'task', 'deadline', 'personal'];
  
  return {
    title: data?.title || 'Untitled',
    from: data?.from || '',
    dueDate: data?.dueDate || null,
    dueDateText: data?.due_date_text || data?.dueDateText || '',
    priority: validPriorities.includes(data?.priority) ? data.priority : 'normal',
    category: validCategories.includes(data?.category) ? data.category : 'task',
    extractedFrom: data?.extracted_from || data?.extractedFrom || '',
  };
};

/**
 * Validates follow-up data
 */
export const validateFollowUp = (data) => {
  const validPriorities = ['high', 'medium', 'low'];
  
  return {
    description: data?.description || data?.context || '',
    person: data?.person || '',
    priority: validPriorities.includes(data?.priority) ? data.priority : 'medium',
    extracted_from: data?.extracted_from || data?.extractedFrom || '',
  };
};