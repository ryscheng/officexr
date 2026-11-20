# Slack integration

Pings a person on Slack when they are offline, so nobody needs a separate mobile app. One Slack app, installed once by a
workspace admin, serves every office. Players do nothing.

## What it does

- A frozen avatar (an offline person at their claimed desk) has a Ping button. It asks the server, which sends that person
  a Slack DM: "<name> is looking for you in <office> — Open office", with the buttons "Open office" (a link to
  `${PUBLIC_URL}/room/<officeId>`) and "I'll be there in 5".
- "I'll be there in 5" reaches the pinger as a chat note in the office. If the pinger has left, it is a Slack DM instead.
- The person is found by their officexr login (their email) with `users.lookupByEmail`, cached for 1 hour (10 minutes for
  "not in Slack").
- With the `users.profile:read` scope, a frozen tag shows the person's Slack status when they have no calendar status.
- One ping per sender and target every 2 minutes. The server also checks that the sender is signed in and the target holds a
  desk in that office.

## Install

1. Open https://api.slack.com/apps, choose Create New App, From a manifest, pick the workspace and paste
   [`manifest.yaml`](manifest.yaml). Set `request_url` to `${PUBLIC_URL}/api/slack/interactions`.
2. Install the app to the workspace (an admin approves the scopes `chat:write`, `im:write`, `users:read`,
   `users:read.email`, `users.profile:read`).
3. Copy the Bot User OAuth Token (Install App page) and the Signing Secret (Basic Information page).
4. Set them in the web backend's environment only, never in the repo or the browser, then restart it:

   ```env
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   ```

5. In Slack, the interactivity URL must show as verified. The server rejects requests with a bad signature, or a
   timestamp more than 5 minutes off, with 401.

## Notes

- Slack may only reach people whose officexr login email matches their Slack email.
- Remove the scope `users.profile:read` if statuses should not be shown; the rest keeps working.
- Without both env vars the whole integration is off and the Ping button on frozen avatars stays hidden.
