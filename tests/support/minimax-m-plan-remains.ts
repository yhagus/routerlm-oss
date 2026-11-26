import type { FakeReply } from './fake-upstream';

export const REMAINS_PATH = '/v1/token_plan/remains';

export const GENERAL_REMAINS = {
  start_time: 1794723370993,
  end_time: 1794741370993,
  remains_time: 5828290,
  current_interval_total_count: 0,
  current_interval_usage_count: 0,
  model_name: 'general',
  current_weekly_total_count: 0,
  current_weekly_usage_count: 0,
  weekly_start_time: 1794455170506,
  weekly_end_time: 1795059970506,
  weekly_remains_time: 324427803,
  current_interval_status: 1,
  current_interval_remaining_percent: 75,
  current_weekly_status: 1,
  current_weekly_remaining_percent: 48,
};

export function remainsReply(modelRemains: object[] = [GENERAL_REMAINS]): FakeReply {
  return {
    kind: 'json',
    status: 200,
    body: { model_remains: modelRemains, base_resp: { status_code: 0, status_msg: 'success' } },
  };
}

export const INVALID_KEY_REPLY: FakeReply = {
  kind: 'json',
  status: 200,
  body: { base_resp: { status_code: 1004, status_msg: 'invalid api key' } },
};

export function remainsAtPercentReply(percent: number): FakeReply {
  return remainsReply([
    {
      ...GENERAL_REMAINS,
      current_interval_remaining_percent: percent,
      current_weekly_remaining_percent: percent,
    },
  ]);
}
