'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Row from '@/components/Row';
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
    <main className="narrow">
      <h1>日历</h1>
      <p className="subtitle">Check-in history</p>

      {error && <p className="status error">{error}</p>}

      <div className="card">
        <div className="sec-head">
          <h2>历史记录</h2>
        </div>
        <p className="hint">先用列表，之后再换成真正的日历组件。</p>

        {loading ? (
          <p className="status">加载中…</p>
        ) : logs.length === 0 ? (
          <p className="empty">
            还没有记录。去 <Link href="/">今日打卡</Link> 填第一条吧。
          </p>
        ) : (
          <ul className="list">
            {logs.map((log) => {
              const hasMetrics =
                log.weight != null ||
                log.sleep_hours != null ||
                log.energy != null ||
                log.felt != null ||
                log.water != null;

              return (
                <li key={log.date}>
                  <div className="entry-head">
                    <span className="entry-date">
                      {log.date} · {weekdayLabel(log.date)}
                    </span>
                    <span>
                      {log.training_status && (
                        <span className="tag stamp">{log.training_status}</span>
                      )}
                      {log.is_period && <span className="tag">生理期</span>}
                    </span>
                  </div>

                  {hasMetrics ? (
                    <>
                      {log.weight != null && <Row label="体重" value={`${log.weight} kg`} />}
                      {log.sleep_hours != null && (
                        <Row label="睡眠" value={`${log.sleep_hours} h`} />
                      )}
                      {log.energy != null && <Row label="精力" value={`${log.energy} / 5`} />}
                      {log.felt != null && <Row label="感受" value={`${log.felt} / 5`} />}
                      {log.water != null && <Row label="饮水" value={`${log.water} ml`} />}
                    </>
                  ) : (
                    <p className="empty">（无数据）</p>
                  )}

                  {(log.morning_note || log.evening_note) && (
                    <p className="entry-note">
                      {[log.morning_note, log.evening_note].filter(Boolean).join(' / ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
