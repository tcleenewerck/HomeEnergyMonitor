# Home Energy Monitor

A small Railway-ready worker that monitors SolarEdge current power flow and sends alerts when configured conditions arise.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Fill `.env` with your real SolarEdge values:

- `SOLAREDGE_SITE_ID`
- `SOLAREDGE_API_KEY`

## Railway setup

Create the same values as Railway environment variables. Railway should build with:

```bash
npm run build
```

And start with:

```bash
npm start
```

On startup, the worker prints a deployment settings overview to the Railway logs. When the daily heartbeat is enabled, it also sends that overview to the heartbeat Slack channel after deployment. Keep that overview complete and up to date whenever you add, remove, or rename a configuration option, alert condition, notification channel, or deployment assumption.

## Deployment sanity checks

Before relying on a deployment, verify:

- External calls have a finite timeout through `REQUEST_TIMEOUT_SECONDS`.
- Repeated SolarEdge polling failures trigger an alert through `MAX_CONSECUTIVE_MONITOR_FAILURES`.
- The local `.env` file is not world-readable. On macOS/Linux, run `chmod 600 .env`.

## Monitoring reliability

External HTTP requests time out after `REQUEST_TIMEOUT_SECONDS`, which defaults to `15`.

If SolarEdge polling fails repeatedly, the worker keeps running and sends an alert after `MAX_CONSECUTIVE_MONITOR_FAILURES` consecutive failures. This defaults to `3` and clears once a later SolarEdge poll succeeds.

Battery and SolarEdge alerts are only sent inside their configured alert timeslots. The worker still monitors and logs outside those windows. The default alert timeslot for both is `07:00-18:00` in `Europe/Brussels`, so evening alerts are suppressed unless you change the window.

- `ALERT_TIMEZONE`: timezone used to evaluate alert timeslots. Defaults to `Europe/Brussels`.
- `BATTERY_ALERT_TIMESLOTS`: comma-separated alert windows for battery alerts, for example `07:00-18:00` or `06:30-11:00,13:00-18:00`. Use `always` for all-day alerts.
- `SOLAREDGE_ALERT_TIMESLOTS`: comma-separated alert windows for SolarEdge alerts and repeated SolarEdge poll-failure alerts. Use `always` for all-day alerts.

## Alert conditions

Set any of these environment variables to enable an alert:

- `MAX_GRID_IMPORT_W`: alert when the house imports more than this from the grid.
- `MAX_GRID_EXPORT_W`: alert when the house exports more than this to the grid.
- `BATTERY_CAPACITY_KWH`: enable a battery-full-soon alert using the usable battery capacity, for example `10`.
- `BATTERY_FULL_NOTICE_MINUTES`: alert when the battery is predicted to be full within this many minutes. Defaults to `5`.
- `BATTERY_FULL_ALERT_RESET_BELOW_PERCENT`: after a full/full-soon alert, do not send another one until the battery drops below this charge level. Defaults to `95`.
- `MIN_BATTERY_CHARGE_RATE_W`: ignore slow trickle charging below this rate. Defaults to `250`.
- `MIN_BATTERY_LEVEL_PERCENT`: alert once when the battery drops below this charge level, for example `50`.

The battery-full-soon alert uses the SolarEdge battery charge level and current storage charging power:

```text
minutes to full = remaining battery kWh / current charging kW * 60
```

For a 10 kWh battery at 95% and 6 kW charging power, the app predicts about 5 minutes until full.
If SolarEdge jumps straight to 100% before the 5-minute window is observed, the app sends a one-time `Battery is full.` fallback alert instead.
After a full/full-soon alert, the app keeps that alert active until the battery drops below `BATTERY_FULL_ALERT_RESET_BELOW_PERCENT`, so small top-ups near 100% do not send repeat alerts.

## SMS alerts

Alerts always go to stdout/stderr so they are visible in Railway logs.

To also send SMS alerts through Twilio, set:

- `SMS_ALERTS_ENABLED=true`

And set all of these variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `ALERT_TO_PHONE_NUMBER`

Phone numbers should be in E.164 format, for example `+32470123456`.

Leave `SMS_ALERTS_ENABLED=false` while the Twilio account is still being processed. The Twilio credentials can be present; they will not be used until SMS alerts are enabled.

## Slack alerts

To send alerts to Slack, create a Slack incoming webhook and set:

- `SLACK_ALERTS_ENABLED=true`
- `SLACK_WEBHOOK_URL`

Leave `SLACK_ALERTS_ENABLED=false` to keep Slack disabled even if a webhook URL is present.

## Test alert configuration

Send a hello message to every enabled alert channel:

```bash
npm run test:alerts
```

The console channel is always enabled. Slack and SMS are tested only when their enable flags are true.

## Daily heartbeat

Send one Slack heartbeat message per day when the configured hour is reached:

- `HEARTBEAT_ENABLED=true`
- `HEARTBEAT_HOUR=8`
- `HEARTBEAT_TIMEZONE=Europe/Brussels`
- `HEARTBEAT_SLACK_WEBHOOK_URL`

`HEARTBEAT_HOUR` is an hour from `0` to `23` in `HEARTBEAT_TIMEZONE`.

To choose the Slack channel, create the incoming webhook for that channel and put it in `HEARTBEAT_SLACK_WEBHOOK_URL`. If `HEARTBEAT_SLACK_WEBHOOK_URL` is empty, the app falls back to `SLACK_WEBHOOK_URL`.
