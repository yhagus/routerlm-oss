-- The Catalog's Alibaba Model Studio (International) entry gained endpoints
-- for the media Kinds on DashScope's native API. The seeder never changes an
-- existing Provider's endpoints (ADR 0026), so an install that already has the
-- Provider gets them here once, for each Kind it has no endpoint for yet.
UPDATE "providers" SET "endpoints" = "endpoints" || coalesce((
  SELECT jsonb_agg("media"."endpoint" ORDER BY "media"."position")
  FROM jsonb_array_elements('[
    {"kind":"image","protocol":"dashscope-image","baseUrl":"https://dashscope-intl.aliyuncs.com/api/v1"},
    {"kind":"speech","protocol":"dashscope-speech","baseUrl":"https://dashscope-intl.aliyuncs.com/api/v1"},
    {"kind":"transcription","protocol":"dashscope-transcription","baseUrl":"https://dashscope-intl.aliyuncs.com/api/v1"},
    {"kind":"video","protocol":"dashscope-video","baseUrl":"https://dashscope-intl.aliyuncs.com/api/v1"}
  ]'::jsonb) WITH ORDINALITY AS "media"("endpoint", "position")
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements("providers"."endpoints") AS "existing"("endpoint")
    WHERE "existing"."endpoint"->>'kind' = "media"."endpoint"->>'kind'
  )
), '[]'::jsonb)
WHERE "slug" = 'alibaba-model-studio-intl' AND "is_from_catalog" = true;
