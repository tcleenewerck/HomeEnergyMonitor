export type TimeSlot = {
  startMinute: number;
  endMinute: number;
};

export type TimeSlotSchedule = {
  timezone: string;
  slots: TimeSlot[];
};

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid monitoring timezone "${timezone}". Use an IANA timezone such as Europe/Brussels.`);
  }
}

function parseTime(value: string, allowEndOfDay: boolean): number {
  if (!timePattern.test(value)) {
    throw new Error(`Invalid time "${value}". Use HH:mm, for example 07:30.`);
  }

  if (value === "24:00") {
    if (!allowEndOfDay) {
      throw new Error("24:00 can only be used as the end of a monitoring timeslot.");
    }

    return 24 * 60;
  }

  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function parseTimeSlotSchedule(value: string, timezone: string, envName: string): TimeSlotSchedule {
  validateTimezone(timezone);

  const trimmed = value.trim();

  if (trimmed.toLowerCase() === "always") {
    return { timezone, slots: [] };
  }

  const slots = trimmed.split(",").map((part) => {
    const [start, end, extra] = part.trim().split("-");

    if (!start || !end || extra !== undefined) {
      throw new Error(`${envName} must contain comma-separated HH:mm-HH:mm ranges or "always".`);
    }

    const startMinute = parseTime(start, false);
    const endMinute = parseTime(end, true);

    if (startMinute === endMinute) {
      throw new Error(`${envName} contains an empty monitoring timeslot: ${part.trim()}.`);
    }

    return { startMinute, endMinute };
  });

  return { timezone, slots };
}

function minutesInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`Could not determine local time for timezone ${timezone}.`);
  }

  return hour * 60 + minute;
}

export function isWithinTimeSlotSchedule(schedule: TimeSlotSchedule, date = new Date()): boolean {
  if (schedule.slots.length === 0) {
    return true;
  }

  const currentMinute = minutesInTimezone(date, schedule.timezone);

  return schedule.slots.some((slot) => {
    if (slot.startMinute < slot.endMinute) {
      return currentMinute >= slot.startMinute && currentMinute < slot.endMinute;
    }

    return currentMinute >= slot.startMinute || currentMinute < slot.endMinute;
  });
}

function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatTimeSlotSchedule(schedule: TimeSlotSchedule): string {
  if (schedule.slots.length === 0) {
    return `always (${schedule.timezone})`;
  }

  return `${schedule.slots
    .map((slot) => `${formatTime(slot.startMinute)}-${formatTime(slot.endMinute)}`)
    .join(", ")} (${schedule.timezone})`;
}
