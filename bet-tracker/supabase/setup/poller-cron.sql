-- Schedule the score poller: Supabase calls the app's /api/poll every 30 seconds.
-- The route itself decides whether to hit ESPN (every 30 s while a tracked game is
-- live or starts within 15 minutes, every 15 min otherwise, never with no games),
-- so most calls return in a few milliseconds without touching ESPN.
--
-- Run once in the Supabase SQL Editor AFTER the app is deployed.
-- Replace the two placeholder values first. Both are stored encrypted in Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP.vercel.app/api/poll', 'bet_poll_url');
select vault.create_secret('PASTE-THE-SAME-VALUE-AS-CRON_SECRET-IN-VERCEL', 'bet_cron_secret');

select cron.schedule(
  'bet-tracker-poll',
  '30 seconds',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bet_poll_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bet_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- To check it:   select * from cron.job_run_details order by start_time desc limit 10;
--                select * from public.poller_state;
-- To change a secret:  select vault.update_secret((select id from vault.secrets where name = 'bet_poll_url'), 'https://new-url/api/poll');
-- To stop it:    select cron.unschedule('bet-tracker-poll');
