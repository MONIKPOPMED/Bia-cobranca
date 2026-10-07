-- lovable-cron-fallback-reviewed: the existing voice campaign dispatcher only processes queued contacts when invoked, and one-minute dispatch latency is required
CREATE OR REPLACE FUNCTION public.configure_voice_campaign_dispatch(p_auth_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE v_existing bigint;
BEGIN
  IF p_auth_token IS NULL OR length(p_auth_token) < 16 THEN RAISE EXCEPTION 'invalid_auth_token'; END IF;
  SELECT jobid INTO v_existing FROM cron.job WHERE jobname = 'voice-campaign-dispatch';
  IF v_existing IS NOT NULL THEN PERFORM cron.unschedule(v_existing); END IF;
  PERFORM cron.schedule('voice-campaign-dispatch', '* * * * *', format(
    $cron$ SELECT net.http_post(
      url := 'https://qsbsnsoswkzrrydkiclz.supabase.co/functions/v1/voice-campaign-dispatch',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey','sb_publishable_iQ5MyMR0EtX1y9G3ykBX9Q_UB6sNGtO',
        'Authorization','Bearer sb_publishable_iQ5MyMR0EtX1y9G3ykBX9Q_UB6sNGtO',
        'x-cron-secret', %L),
      body := '{}'::jsonb, timeout_milliseconds := 30000); $cron$, p_auth_token));
END; $function$;
REVOKE ALL ON FUNCTION public.configure_voice_campaign_dispatch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_voice_campaign_dispatch(text) TO service_role;

DO $$
DECLARE v_cmd text; v_tok text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'whatsapp-campaign-dispatch';
  v_tok := substring(v_cmd from 'Bearer ([A-Za-z0-9_\-\.]+)');
  IF v_tok IS NOT NULL THEN PERFORM public.configure_voice_campaign_dispatch(v_tok); END IF;
END $$;