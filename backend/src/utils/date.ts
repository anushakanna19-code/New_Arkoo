// ─── Date Utilities ────────────────────────────────────────
// Extracted from server.ts lines 27-123

export function parseRelativeDeadline(val: string, baseDate: Date = new Date()): Date {
  const clean = String(val || '').trim().toLowerCase();
  const now = new Date(baseDate);

  const directParse = new Date(val);
  if (!isNaN(directParse.getTime()) && (clean.includes('-') || clean.includes('/') || clean.includes('t'))) {
    return directParse;
  }

  let hour = 17; // Default 5:00 PM
  let minute = 0;

  const timeMatch = clean.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let parsedHour = parseInt(timeMatch[1], 10);
    const parsedMin = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (ampm === 'pm' && parsedHour < 12) parsedHour += 12;
    if (ampm === 'am' && parsedHour === 12) parsedHour = 0;

    if (parsedHour >= 0 && parsedHour <= 23) {
      hour = parsedHour;
      minute = parsedMin;
    }
  }

  const setTargetTime = (d: Date) => {
    const r = new Date(d);
    r.setHours(hour, minute, 0, 0);
    return r;
  };

  const nextWeekday = (target: number) => {
    const d = new Date(now);
    const currentDay = d.getDay();
    let diff = target - currentDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return setTargetTime(d);
  };

  if (clean.includes('immediate') || clean.includes('eod') || clean.includes('now') || clean.includes('today') || clean.includes('end of day')) {
    return setTargetTime(now);
  }
  if (clean.includes('tomorrow')) {
    const tom = new Date(now);
    tom.setDate(tom.getDate() + 1);
    return setTargetTime(tom);
  }
  if (clean.includes('monday')) return nextWeekday(1);
  if (clean.includes('tuesday')) return nextWeekday(2);
  if (clean.includes('wednesday')) return nextWeekday(3);
  if (clean.includes('thursday')) return nextWeekday(4);
  if (clean.includes('friday')) return nextWeekday(5);
  if (clean.includes('saturday')) return nextWeekday(6);
  if (clean.includes('sunday')) return nextWeekday(0);
  if (clean.includes('next week')) {
    const nw = new Date(now);
    nw.setDate(nw.getDate() + 7);
    return setTargetTime(nw);
  }

  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 3);
  return setTargetTime(fallback);
}

export function formatDeadlineDisplay(deadline: any): string {
  if (!deadline) return 'No deadline';

  let dateObj: Date | null = null;
  if (deadline && typeof deadline.toDate === 'function') {
    dateObj = deadline.toDate();
  } else if (deadline && deadline.seconds) {
    dateObj = new Date(deadline.seconds * 1000);
  } else if (deadline instanceof Date) {
    dateObj = deadline;
  } else if (typeof deadline === 'string') {
    dateObj = parseRelativeDeadline(deadline);
  }

  if (!dateObj || isNaN(dateObj.getTime())) {
    return String(deadline);
  }

  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  let hours = dateObj.getHours();
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');

  return `${day}-${month}-${year}, ${strHours}:${minutes} ${ampm}`;
}
