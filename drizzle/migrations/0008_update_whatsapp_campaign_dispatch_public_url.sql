-- lovable-cron-fallback-reviewed: manter o polling de cinco minutos solicitado para processar campanhas agendadas sem alterar a lógica existente
CREATE OR REPLACE FUNCTION public.configure_whatsapp_campaign_dispatch(p_auth_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'net'
AS $function$
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
          url := 'https://bia-cobranca.lovable.app/api/public/whatsapp-campaign-dispatch',
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
$function$;

DO $do$
DECLARE
  v_auth_token text;
BEGIN
  SELECT (regexp_match(command, '''Authorization'', ''Bearer ([^'']+)'''))[1]
  INTO v_auth_token
  FROM cron.job
  WHERE jobname = 'whatsapp-campaign-dispatch';

  IF v_auth_token IS NULL OR length(v_auth_token) < 16 THEN
    RAISE EXCEPTION 'LOVABLE_CRON_SECRET not found in existing job';
  END IF;

  PERFORM public.configure_whatsapp_campaign_dispatch(v_auth_token);
END;
$do$;