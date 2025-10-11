export const parseDateTimeFromText = (timeText) => {
  if (!timeText) return null;

  const now = new Date();
  const timeTextLower = timeText.toLowerCase().trim();

  const patterns = {
    'tomorrow': new Date(now.getTime() + 24 * 60 * 60 * 1000),
    'today': now,
    'next week': new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    'next month': new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    'end of week': (() => {
      const friday = new Date(now);
      friday.setDate(now.getDate() + (5 - now.getDay()));
      return friday;
    })(),
    'end of day': (() => {
      const eod = new Date(now);
      eod.setHours(17, 0, 0, 0);
      return eod;
    })(),
  };

  for (const [pattern, baseDate] of Object.entries(patterns)) {
    if (timeTextLower.includes(pattern)) {
      const timeMatch = timeTextLower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/);
      
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const meridiem = timeMatch[3];

        if (meridiem && meridiem.includes('p') && hour < 12) {
          hour += 12;
        } else if (meridiem && meridiem.includes('a') && hour === 12) {
          hour = 0;
        }

        baseDate.setHours(hour, minute, 0, 0);
      }

      return baseDate;
    }
  }

  const inDuration = timeTextLower.match(/in\s+(\d+)\s+(hour|day|week)s?/);
  if (inDuration) {
    const amount = parseInt(inDuration[1]);
    const unit = inDuration[2];
    const multiplier = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 };
    return new Date(now.getTime() + amount * multiplier[unit]);
  }

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let i = 0; i < days.length; i++) {
    if (timeTextLower.includes(days[i])) {
      let daysAhead = (i - now.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      
      const targetDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      
      const timeMatch = timeTextLower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const meridiem = timeMatch[3];

        if (meridiem && meridiem === 'pm' && hour < 12) hour += 12;
        
        targetDate.setHours(hour, minute, 0, 0);
      }
      
      return targetDate;
    }
  }

  return null;
};