const ffmpeg = require('fluent-ffmpeg');
const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

async function convertToWav(inputBuffer, outputPath) {
  const tempInput = path.join('/tmp', `input-${Date.now()}.audio`);
  
  try {
    await fs.writeFile(tempInput, inputBuffer);
    
    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .toFormat('wav')
        .audioFrequency(16000)
        .audioChannels(1)
        .on('end', async () => {
          try {
            await fs.unlink(tempInput);
            resolve(outputPath);
          } catch (err) {
            logger.error('Cleanup failed:', err);
            resolve(outputPath);
          }
        })
        .on('error', async (err) => {
          try {
            await fs.unlink(tempInput);
          } catch {}
          reject(err);
        })
        .save(outputPath);
    });
  } catch (error) {
    logger.error('Audio conversion failed:', error);
    throw new Error('Audio conversion failed');
  }
}

module.exports = { convertToWav };