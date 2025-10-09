function parseDateTimeFromText(text) {
  if (!text) return null;

  const now = new Date();
  const lower = text.toLowerCase();

  const patterns = {
    'tomorrow': () => {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return extractTime(tomorrow, text);
    },
    'today': () => extractTime(new Date(now), text),
    'next week': () => {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return nextWeek;
    },
    'end of week': () => {
      const endOfWeek = new Date(now);
      const daysUntilFriday = (5 - now.getDay() + 7) % 7;
      endOfWeek.setDate(endOfWeek.getDate() + daysUntilFriday);
      endOfWeek.setHours(17, 0, 0, 0);
      return endOfWeek;
    },
    'end of day': () => {
      const endOfDay = new Date(now);
      endOfDay.setHours(17, 0, 0, 0);
      return endOfDay;
    }
  };

  for (const [pattern, handler] of Object.entries(patterns)) {
    if (lower.includes(pattern)) {
      return handler();
    }
  }

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const target = new Date(now);
      let daysAhead = (i - now.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      target.setDate(target.getDate() + daysAhead);
      return extractTime(target, text);
    }
  }

  const inDuration = text.match(/in\s+(\d+)\s+(hour|day|week)s?/i);
  if (inDuration) {
    const amount = parseInt(inDuration[1]);
    const unit = inDuration[2].toLowerCase();
    const result = new Date(now);
    
    if (unit === 'hour') result.setHours(result.getHours() + amount);
    else if (unit === 'day') result.setDate(result.getDate() + amount);
    else if (unit === 'week') result.setDate(result.getDate() + (amount * 7));
    
    return result;
  }

  return null;
}

function extractTime(date, text) {
  const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2] || '0');
    const meridiem = timeMatch[3];
    
    if (meridiem && /p/i.test(meridiem) && hour < 12) {
      hour += 12;
    } else if (meridiem && /a/i.test(meridiem) && hour === 12) {
      hour = 0;
    }
    
    date.setHours(hour, minute, 0, 0);
  }
  
  return date;
}

module.exports = { parseDateTimeFromText };