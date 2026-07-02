ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS phone_carrier text;

COMMENT ON COLUMN public.auto_campaign_input_data.phone_carrier IS
  'Vietnam mobile carrier code inferred from phone prefix: viettel, vinaphone, mobifone, vietnamobile, gmobile, itel, wintel, or unknown.';

WITH source_rows AS (
  SELECT
    id,
    regexp_replace(coalesce(phone, ''), '\D+', '', 'g') AS digits
  FROM public.auto_campaign_input_data
  WHERE nullif(btrim(coalesce(phone, '')), '') IS NOT NULL
    AND nullif(btrim(coalesce(phone_carrier, '')), '') IS NULL
),
normalized_rows AS (
  SELECT
    id,
    CASE
      WHEN digits LIKE '0084%' AND length(digits) >= 13 THEN '0' || substr(digits, 5)
      WHEN digits LIKE '84%' AND length(digits) >= 11 THEN '0' || substr(digits, 3)
      WHEN length(digits) = 9 AND digits ~ '^[35789]' THEN '0' || digits
      ELSE digits
    END AS phone
  FROM source_rows
  WHERE digits <> ''
),
converted_rows AS (
  SELECT
    id,
    CASE
      WHEN length(phone) = 10 THEN
        CASE '0' || substr(phone, 1, 3)
          WHEN '0162' THEN '032' || substr(phone, 4)
          WHEN '0163' THEN '033' || substr(phone, 4)
          WHEN '0164' THEN '034' || substr(phone, 4)
          WHEN '0165' THEN '035' || substr(phone, 4)
          WHEN '0166' THEN '036' || substr(phone, 4)
          WHEN '0167' THEN '037' || substr(phone, 4)
          WHEN '0168' THEN '038' || substr(phone, 4)
          WHEN '0169' THEN '039' || substr(phone, 4)
          WHEN '0120' THEN '070' || substr(phone, 4)
          WHEN '0121' THEN '079' || substr(phone, 4)
          WHEN '0122' THEN '077' || substr(phone, 4)
          WHEN '0126' THEN '076' || substr(phone, 4)
          WHEN '0128' THEN '078' || substr(phone, 4)
          WHEN '0123' THEN '083' || substr(phone, 4)
          WHEN '0124' THEN '084' || substr(phone, 4)
          WHEN '0125' THEN '085' || substr(phone, 4)
          WHEN '0127' THEN '081' || substr(phone, 4)
          WHEN '0129' THEN '082' || substr(phone, 4)
          WHEN '0186' THEN '056' || substr(phone, 4)
          WHEN '0188' THEN '058' || substr(phone, 4)
          WHEN '0199' THEN '059' || substr(phone, 4)
          ELSE phone
        END
      WHEN length(phone) = 11 THEN
        CASE substr(phone, 1, 4)
          WHEN '0162' THEN '032' || substr(phone, 5)
          WHEN '0163' THEN '033' || substr(phone, 5)
          WHEN '0164' THEN '034' || substr(phone, 5)
          WHEN '0165' THEN '035' || substr(phone, 5)
          WHEN '0166' THEN '036' || substr(phone, 5)
          WHEN '0167' THEN '037' || substr(phone, 5)
          WHEN '0168' THEN '038' || substr(phone, 5)
          WHEN '0169' THEN '039' || substr(phone, 5)
          WHEN '0120' THEN '070' || substr(phone, 5)
          WHEN '0121' THEN '079' || substr(phone, 5)
          WHEN '0122' THEN '077' || substr(phone, 5)
          WHEN '0126' THEN '076' || substr(phone, 5)
          WHEN '0128' THEN '078' || substr(phone, 5)
          WHEN '0123' THEN '083' || substr(phone, 5)
          WHEN '0124' THEN '084' || substr(phone, 5)
          WHEN '0125' THEN '085' || substr(phone, 5)
          WHEN '0127' THEN '081' || substr(phone, 5)
          WHEN '0129' THEN '082' || substr(phone, 5)
          WHEN '0186' THEN '056' || substr(phone, 5)
          WHEN '0188' THEN '058' || substr(phone, 5)
          WHEN '0199' THEN '059' || substr(phone, 5)
          ELSE phone
        END
      ELSE phone
    END AS phone
  FROM normalized_rows
),
carrier_rows AS (
  SELECT
    id,
    CASE
      WHEN phone !~ '^0[35789][0-9]{8}$' THEN NULL
      WHEN substr(phone, 1, 3) IN ('032', '033', '034', '035', '036', '037', '038', '039', '086', '096', '097', '098') THEN 'viettel'
      WHEN substr(phone, 1, 3) IN ('081', '082', '083', '084', '085', '088', '091', '094') THEN 'vinaphone'
      WHEN substr(phone, 1, 3) IN ('070', '076', '077', '078', '079', '089', '090', '093') THEN 'mobifone'
      WHEN substr(phone, 1, 3) IN ('052', '056', '058', '092') THEN 'vietnamobile'
      WHEN substr(phone, 1, 3) IN ('059', '099') THEN 'gmobile'
      WHEN substr(phone, 1, 3) = '087' THEN 'itel'
      WHEN substr(phone, 1, 3) = '055' THEN 'wintel'
      ELSE 'unknown'
    END AS phone_carrier
  FROM converted_rows
)
UPDATE public.auto_campaign_input_data target
SET phone_carrier = carrier_rows.phone_carrier
FROM carrier_rows
WHERE target.id = carrier_rows.id
  AND carrier_rows.phone_carrier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_input_data_phone_carrier_status_schedule
  ON public.auto_campaign_input_data (campaign_id, phone_carrier, status, schedule)
  WHERE is_delete = false
    AND phone_carrier IS NOT NULL;

NOTIFY pgrst, 'reload schema';
