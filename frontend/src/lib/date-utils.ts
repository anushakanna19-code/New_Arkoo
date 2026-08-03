import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';

export function parseFirestoreDate(field: any): Date | null {
  if (!field) return null;
  if (field.toDate && typeof field.toDate === 'function') {
    return field.toDate();
  }
  if (field.seconds) {
    return new Date(field.seconds * 1000);
  }
  if (field instanceof Date) {
    return field;
  }
  const parsed = new Date(field);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  return null;
}

export function parseRelativeDeadline(val: string, baseDate: Date = new Date()): Date {
  const clean = String(val || '').trim().toLowerCase();
  const now = new Date(baseDate);

  // If already a valid ISO or date string, try parsing directly
  const directParse = new Date(val);
  if (!isNaN(directParse.getTime()) && (clean.includes('-') || clean.includes('/') || clean.includes('t'))) {
    return directParse;
  }

  // Parse time of day from string, e.g. "5 pm", "5:30 pm", "17:00", "2 pm", "noon"
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
    if (diff <= 0) diff += 7; // Target next occurrence
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
  if (clean.includes('this week')) {
    return nextWeekday(5); // Friday of this week
  }

  // Fallback: 3 days from now at setTargetTime
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 3);
  return setTargetTime(fallback);
}

export function formatDeadlineDisplay(deadline: any): string {
  if (!deadline) return 'No deadline';

  let dateObj: Date | null = parseFirestoreDate(deadline);

  if (!dateObj && typeof deadline === 'string') {
    dateObj = parseRelativeDeadline(deadline);
  } else if (typeof deadline === 'string' && (deadline.includes('am') || deadline.includes('pm') || deadline.includes('Friday') || deadline.includes('Tuesday') || deadline.includes('Monday') || deadline.includes('Wednesday') || deadline.includes('Thursday') || deadline.includes('Saturday') || deadline.includes('Sunday') || deadline.includes('tomorrow') || deadline.includes('today'))) {
    const relParsed = parseRelativeDeadline(deadline);
    if (relParsed) dateObj = relParsed;
  }

  if (!dateObj || isNaN(dateObj.getTime())) {
    return String(deadline);
  }

  return format(dateObj, 'dd-MM-yyyy, hh:mm a'); // Format: 01-08-2026, 05:00 PM
}

export function parseInputDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day, 12, 0, 0); // Noon to prevent timezone wrap
  }
  return new Date(dateStr);
}

export function isOverdue(deadline: any, status: string): boolean {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return false;
  
  const dDate = parseFirestoreDate(deadline);
  if (!dDate) return false;
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return dDate < todayStart;
}
