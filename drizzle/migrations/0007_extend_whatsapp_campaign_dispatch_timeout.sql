-- lovable-cron-fallback-reviewed: 288 runs/day; campanhas agendadas e retentativas exigem atraso máximo de cinco minutos, e o endpoint pode precisar de mais de cinco segundos para concluir o lote.
CREATE OR REPLACE FUNCTION public.configure_whatsapp_campaign_dispatch(p_auth_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_existing bigint;
BEGIN
  IF p_auth_token IS NULL OR length(p_auth_token) < 16 THEN
    RAISE EXCEPTION 'invalid_auth_token';
  END IF;

  SELECT jobid INTO v_existing
  FROM cron.job
  WHERE jobname = 'whatsapp-campaign-dispatch';

  IF v_existing IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing);
  END IF;

  PERFORM cron.schedule(
    'whatsapp-campaign-dispatch',
    '*/5 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := 'https://nexus-ai-voice-memories.lovable.app/api/public/whatsapp-campaign-dispatch',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer %s'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $cron$,
      p_auth_token
    )
  );
END;
$$;