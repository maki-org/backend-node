const Groq = require('groq-sdk');
const { logger } = require('../utils/logger');

let groqClient = null;

function getGroqClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    groqClient = new Groq({ apiKey });
    logger.info('Groq client initialized');
  }

  return groqClient;
}

module.exports = { getGroqClient };