import { formatDateTime } from "@/lib/locale";

/** The reminder times offered for a saved message, worked out from `now` when the menu opens. */
export function reminderPresets(now = new Date()): { label: string; at: number }[] {
  const at = (hours: number) => now.getTime() + hours * 60 * 60 * 1000;
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(now.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  nextMonday.setHours(9, 0, 0, 0);
  return [
    { label: "In 20 minutes", at: at(1 / 3) },
    { label: "In 1 hour", at: at(1) },
    { label: "In 3 hours", at: at(3) },
    { label: "Tomorrow at 9:00", at: tomorrowMorning.getTime() },
    { label: "Next Monday at 9:00", at: nextMonday.getTime() },
  ];
}

export function describeReminder(at: number, now = Date.now()): string {
  if (at <= now) return "Reminder due";
  return `Remind ${formatDateTime(at, { dateStyle: "medium", timeStyle: "short" })}`;
}
