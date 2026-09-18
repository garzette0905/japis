// 클릭은 가볍게 누적하고, 실제 표시 순위는 하루 한 번만 확정한다.

const TYPES = new Set(['service', 'bookmark', 'wiki_folder']);
const nowIso = () => new Date().toISOString();

export async function countUsage(env, userId, type, key) {
  type = String(type || '');
  key = String(key || '').slice(0, 120);
  if (!TYPES.has(type) || !key) return;
  await env.DB.prepare(
    `INSERT INTO usage_rankings
       (user_id, item_type, item_key, click_count, ranked_click_count, sort_rank, updated_at)
     VALUES (?, ?, ?, 1, 0, 2147483647, ?)
     ON CONFLICT(user_id, item_type, item_key) DO UPDATE SET
       click_count = click_count + 1,
       updated_at = excluded.updated_at`
  ).bind(userId, type, key, nowIso()).run();
}

export async function ranksFor(env, userId, type) {
  const { results } = await env.DB.prepare(
    'SELECT item_key, sort_rank FROM usage_rankings WHERE user_id = ? AND item_type = ?'
  ).bind(userId, type).all();
  return new Map((results || []).map((r) => [String(r.item_key), Number(r.sort_rank)]));
}

/** 같은 사용량이면 전날 순위, 처음인 항목끼리는 key 순으로 안정적으로 세운다. */
export async function refreshUsageRanks(env) {
  const at = nowIso();
  await env.DB.prepare(
    `WITH ranked AS (
       SELECT user_id, item_type, item_key,
              ROW_NUMBER() OVER (
                PARTITION BY user_id, item_type
                ORDER BY click_count DESC, sort_rank, item_key
              ) AS next_rank
         FROM usage_rankings
     )
     UPDATE usage_rankings AS u
        SET sort_rank = (
              SELECT next_rank FROM ranked AS r
               WHERE r.user_id = u.user_id
                 AND r.item_type = u.item_type
                 AND r.item_key = u.item_key
            ),
            ranked_click_count = click_count,
            ranked_at = ?`
  ).bind(at).run();
}
