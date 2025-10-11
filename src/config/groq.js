import Groq from 'groq-sdk';
import logger from '../utils/logger.js';

let groqClient = null;

const initializeGroq = () => {
  try {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY not found in environment');
    }

    groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    logger.info('Groq client initialized successfully');
    return groqClient;
  } catch (error) {
    logger.error(`Groq initialization failed: ${error.message}`);
    throw error;
  }
};

export const getGroqClient = () => {
  if (!groqClient) {
    return initializeGroq();
  }
  return groqClient;
};

export default initializeGroq;