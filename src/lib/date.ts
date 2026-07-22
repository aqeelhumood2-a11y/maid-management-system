import { addDays, format, startOfWeek } from "date-fns";

export const BAHRAIN_TZ = "Asia/Bahrain";

const bahrainPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BAHRAIN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in Asia/Bahrain, as yyyy-MM-dd (en-CA locale formats as yyyy-MM-dd). */
export function todayBahrain(): string {
  return bahrainPartsFormatter.format(new Date());
}

/** Any instant's calendar date in Asia/Bahrain, as yyyy-MM-dd. */
export function dateInBahrain(date: Date): string {
  return bahrainPartsFormatter.format(date);
}

/** Parses a yyyy-MM-dd string into a UTC-anchored Date (calendar-safe, no tz drift). */
export function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

export function formatDateOnly(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  return formatDateOnly(addDays(parseDateOnly(dateStr), days));
}

/** 0=Sunday ... 6=Saturday, computed from the calendar date only (timezone independent). */
export function dayOfWeek(dateStr: string): number {
  return parseDateOnly(dateStr).getUTCDay();
}

export function isFriday(dateStr: string): boolean {
  return dayOfWeek(dateStr) === 5;
}

/** Start (Saturday) of the Bahrain work-week containing dateStr. Week runs Sat-Fri. */
export function weekStart(dateStr: string): string {
  // date-fns startOfWeek with weekStartsOn=6 (Saturday)
  const start = startOfWeek(parseDateOnly(dateStr), { weekStartsOn: 6 });
  return formatDateOnly(start);
}

export function weekDates(weekStartStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStartStr, i));
}

const WEEKDAY_LABELS_AR: Record<number, string> = {
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
};

export function weekdayLabelAr(dateStr: string): string {
  return WEEKDAY_LABELS_AR[dayOfWeek(dateStr)];
}

export function formatDateAr(dateStr: string): string {
  const d = parseDateOnly(dateStr);
  return new Intl.DateTimeFormat("ar-BH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatDateShortAr(dateStr: string): string {
  const d = parseDateOnly(dateStr);
  return new Intl.DateTimeFormat("ar-BH", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatTimestampAr(date: Date): string {
  return new Intl.DateTimeFormat("ar-BH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BAHRAIN_TZ,
  }).format(date);
}

export function isPastDate(dateStr: string): boolean {
  return dateStr < todayBahrain();
}
