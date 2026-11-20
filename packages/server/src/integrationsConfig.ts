import { createCalendarService, type CalendarLinks } from './calendarService';
import { createGoogleCalendarClient } from './googleCalendar';
import type { CalendarIntegration, SlackIntegration } from './integrations';
import { createSecretBox } from './secretBox';
import { createSlackClient, createSlackDirectory } from './slack';

export interface IntegrationServices {
  calendar?: CalendarIntegration;
  slack?: SlackIntegration;
}

export interface IntegrationEnv {
  env: Record<string, string | undefined>;
  publicUrl: string | undefined;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  calendarLinks: CalendarLinks;
  fetch?: typeof fetch;
}

export function integrationsFromEnv({ env, publicUrl, googleClientId, googleClientSecret, calendarLinks, fetch: fetchFn }: IntegrationEnv): IntegrationServices {
  const services: IntegrationServices = {};
  const encryptionSecret = env.CALENDAR_ENCRYPTION_SECRET;
  if (encryptionSecret && publicUrl && googleClientId && googleClientSecret) {
    try {
      const config = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: new URL('/auth/google/calendar/callback', publicUrl).href };
      services.calendar = {
        config,
        service: createCalendarService({ client: createGoogleCalendarClient(config, fetchFn), links: calendarLinks, box: createSecretBox(encryptionSecret) }),
      };
    } catch {
      console.error('[calendar] CALENDAR_ENCRYPTION_SECRET is too short (at least 16 characters); the calendar integration is off.');
    }
  }
  if (env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET) {
    const client = createSlackClient(env.SLACK_BOT_TOKEN, fetchFn);
    services.slack = { signingSecret: env.SLACK_SIGNING_SECRET, client, directory: createSlackDirectory({ client }) };
  }
  return services;
}
