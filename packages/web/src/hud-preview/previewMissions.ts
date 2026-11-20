import type { Mission, MissionsClient, VoiceZone } from '@officexr/sdk';
import { MissionsUnsupportedError } from '../hud/missions/missionsApi';

export const PREVIEW_OFFICE_ID = 'hud-preview';

/** Rooms in metres, laid out around the map's spawn point (12, 12). */
export const PREVIEW_ZONES: VoiceZone[] = [
  { id: 'lobby', label: 'Lobby', min: { x: 2, z: 2 }, max: { x: 9, z: 10 } },
  { id: 'meeting-1', label: 'Meeting room 1', min: { x: 17, z: 4 }, max: { x: 25, z: 12 } },
  { id: 'kitchen', label: 'Kitchen', min: { x: 2, z: 18 }, max: { x: 9, z: 24 } },
  { id: 'focus', label: 'Focus booths', min: { x: 18, z: 16 }, max: { x: 26, z: 24 } },
];

const at = (hours: number, minutes: number, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

export function previewMissions(me: string): Mission[] {
  const base = { officeId: PREVIEW_OFFICE_ID, source: 'mine' as const, ownerLogin: me, personLogin: null, shared: false, done: false };
  const stamp = { createdAt: at(8, 0), updatedAt: at(8, 0) };
  return [
    {
      ...base,
      ...stamp,
      id: 'm1',
      title: 'Join the stand-up',
      steps: [],
      place: { kind: 'room', id: 'meeting-1', label: 'Meeting room 1' },
      dueAt: at(10, 0),
    },
    {
      ...base,
      ...stamp,
      id: 'm2',
      title: 'Fix the login redirect',
      steps: [
        { text: 'Reproduce it', done: true },
        { text: 'Write the fix', done: false },
        { text: 'Open the pull request', done: false },
      ],
      place: null,
      dueAt: null,
    },
    {
      ...base,
      ...stamp,
      id: 'm3',
      title: 'Book a table for the team lunch',
      steps: [
        { text: 'Pick a place', done: false },
        { text: 'Tell the team', done: false },
      ],
      place: { kind: 'room', id: 'kitchen', label: 'Kitchen' },
      dueAt: at(11, 30),
    },
    {
      ...base,
      ...stamp,
      id: 'm4',
      title: 'Ask Bao about the demo',
      steps: [],
      place: null,
      dueAt: null,
      personLogin: 'bao@example.test',
      done: true,
      updatedAt: at(9, 12),
    },
    {
      ...base,
      ...stamp,
      id: 't1',
      ownerLogin: 'bao@example.test',
      shared: true,
      title: 'Review the Q3 roadmap',
      steps: [],
      place: { kind: 'room', id: 'focus', label: 'Focus booths' },
      dueAt: at(14, 0),
    },
  ];
}

export const unsupportedMissionsClient: MissionsClient = {
  list: () => Promise.reject(new MissionsUnsupportedError()),
  create: () => Promise.reject(new MissionsUnsupportedError()),
  update: () => Promise.reject(new MissionsUnsupportedError()),
  remove: () => Promise.reject(new MissionsUnsupportedError()),
};
