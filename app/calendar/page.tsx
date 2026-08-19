'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { weekdayLabel } from '@/lib/date';
import type { DailyLog } from '@/lib/types';

export default function CalendarPage() {
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/daily-logs?limit=90')
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load');
        return json;
      })
      .then((json) => setLogs(json.logs ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main>
      <h1>日历</h1>
      <p className="subtitle">
        历史打卡记录（先用列表，之后再换成真正的日历组件）。
      </p>

      {error && <p className="status error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="status">加载中…</p>
        ) : logs.length === 0 ? (
          <p className="empty">
            还没有记录。去 <Link href="/">今日打卡</Link> 填第一条吧。
          </p>
        ) : (
          <ul className="list">
            {logs.map((log) => (
              <li key={log.date}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {log.date} · {weekdayLabel(log.date)}
                  </strong>
                  <span>
                    {log.training_status && <span className="tag">{log.training_status}</span>}
                    {log.is_period && <span className="tag">生理期</span>}
                  </span>
                </div>
                <p className="meta" style={{ margin: '4px 0 0' }}>
                  {[
                    log.weight != null ? `体重 ${log.weight}kg` : null,
                    log.sleep_hours != null ? `睡眠 ${log.sleep_hours}h` : null,
                    log.energy != null ? `精力 ${log.energy}/5` : null,
                    log.felt != null ? `感受 ${log.felt}/5` : null,
                    log.water != null ? `饮水 ${log.water}ml` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '（无数据）'}
                </p>
                {(log.morning_note || log.evening_note) && (
                  <p className="meta" style={{ margin: '4px 0 0' }}>
                    {[log.morning_note, log.evening_note].filter(Boolean).join(' / ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
