import type { ClaimantCalendar, ClaimantSlack } from '@officexr/sdk';

const AWAY = 'Away';

const SLACK_EMOJI: Record<string, string> = {
  ':spiral_calendar_pin:': '🗓️',
  ':calendar:': '📅',
  ':palm_tree:': '🌴',
  ':face_with_thermometer:': '🤒',
  ':house_with_garden:': '🏡',
  ':house:': '🏠',
  ':headphones:': '🎧',
  ':coffee:': '☕',
  ':speech_balloon:': '💬',
  ':no_entry:': '⛔',
  ':bus:': '🚌',
  ':airplane:': '✈️',
  ':hamburger:': '🍔',
  ':sleeping:': '😴',
};

export interface FrozenStatusSeam {
  formatTime?: (at: Date) => string;
}

const localTime = (at: Date): string => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function formatSlackStatus({ text, emoji }: ClaimantSlack): string {
  const glyph = emoji ? (SLACK_EMOJI[emoji] ?? '') : '';
  return [glyph, text].filter(Boolean).join(' ') || AWAY;
}

export function frozenStatusLabel(
  frozen: { calendar?: ClaimantCalendar; slack?: ClaimantSlack },
  { formatTime = localTime }: FrozenStatusSeam = {},
): string {
  const { calendar, slack } = frozen;
  if (calendar) {
    const until = new Date(calendar.until);
    if (!Number.isNaN(until.getTime())) {
      return `${calendar.busy ? 'In a meeting' : 'Free'} until ${formatTime(until)}`;
    }
  }
  return slack ? formatSlackStatus(slack) : AWAY;
}
