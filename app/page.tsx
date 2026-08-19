'use client';

import { useCallback, useEffect, useState } from 'react';
import { todayISO, weekdayLabel } from '@/lib/date';
import { parseTrainingPlan, resolveVideos, type TrainingPlan } from '@/lib/plan';
import { TRAINING_STATUSES, type DailyLog, type Video } from '@/lib/types';

type Saving = 'idle' | 'saving' | 'saved' | 'error';

const RATINGS = [1, 2, 3, 4, 5];

export default function TodayPage() {
  const [date, setDate] = useState(todayISO());
  const [log, setLog] = useState<DailyLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // morning
  const [weight, setWeight] = useState('');
  const [sleepHours, setSleepHours] = useState('');
  const [energy, setEnergy] = useState('');
  const [isPeriod, setIsPeriod] = useState(false);
  const [morningNote, setMorningNote] = useState('');
  const [morningSaving, setMorningSaving] = useState<Saving>('idle');

  // evening
  const [trainingStatus, setTrainingStatus] = useState('');
  const [felt, setFelt] = useState('');
  const [water, setWater] = useState('');
  const [eveningNote, setEveningNote] = useState('');
  const [eveningSaving, setEveningSaving] = useState<Saving>('idle');

  // AI plan
  const [library, setLibrary] = useState<Video[]>([]);
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);
  const [foodPlan, setFoodPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [reviseMessage, setReviseMessage] = useState('');
  const [revising, setRevising] = useState(false);

  const hydrate = useCallback((next: DailyLog | null) => {
    setLog(next);
    setWeight(next?.weight != null ? String(next.weight) : '');
    setSleepHours(next?.sleep_hours != null ? String(next.sleep_hours) : '');
    setEnergy(next?.energy != null ? String(next.energy) : '');
    setIsPeriod(next?.is_period ?? false);
    setMorningNote(next?.morning_note ?? '');
    setTrainingStatus(next?.training_status ?? '');
    setFelt(next?.felt != null ? String(next.felt) : '');
    setWater(next?.water != null ? String(next.water) : '');
    setEveningNote(next?.evening_note ?? '');
    setTrainingPlan(parseTrainingPlan(next?.ai_training_plan));
    setFoodPlan(next?.ai_food_plan ?? null);
  }, []);

  // The video library is the lookup table for AI-suggested video_ids. Loaded
  // once: ids are only ever rendered by resolving them against this list.
  useEffect(() => {
    fetch('/api/videos')
      .then((res) => res.json())
      .then((json) => setLibrary(json.videos ?? []))
      .catch(() => setLibrary([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/daily-logs?date=${date}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load');
        return json;
      })
      .then((json) => {
        if (!cancelled) hydrate(json.log ?? null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, hydrate]);

  async function save(patch: Partial<DailyLog>, setSaving: (s: Saving) => void) {
    setSaving('saving');
    setError(null);
    try {
      const res = await fetch('/api/daily-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setLog(json.log);
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 2000);
    } catch (err) {
      setSaving('error');
      setError((err as Error).message);
    }
  }

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  function saveMorning(e: React.FormEvent) {
    e.preventDefault();
    save(
      {
        weight: num(weight),
        sleep_hours: num(sleepHours),
        energy: num(energy),
        is_period: isPeriod,
        morning_note: morningNote.trim() || null,
      },
      setMorningSaving,
    );
  }

  function saveEvening(e: React.FormEvent) {
    e.preventDefault();
    save(
      {
        training_status: (trainingStatus || null) as DailyLog['training_status'],
        felt: num(felt),
        water: num(water),
        evening_note: eveningNote.trim() || null,
      },
      setEveningSaving,
    );
  }

  /**
   * Shared by generate and revise: both hit a route that returns the same
   * `{ ok, plan }` envelope, where ok:false is a retry state rather than a throw.
   */
  async function requestPlan(endpoint: string, payload: Record<string, unknown>) {
    setPlanError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...payload }),
      });
      const json = await res.json();

      if (!res.ok) {
        setPlanError(json.error ?? '请求失败，请重试。');
        return false;
      }
      if (!json.ok) {
        setPlanError(json.error);
        return false;
      }

      setTrainingPlan(json.plan.training_plan);
      setFoodPlan(json.plan.food_plan);
      return true;
    } catch {
      setPlanError('网络错误，请重试。');
      return false;
    }
  }

  async function generatePlan() {
    setPlanLoading(true);
    await requestPlan('/api/daily-logs/generate-plan', {});
    setPlanLoading(false);
  }

  async function revisePlan(e: React.FormEvent) {
    e.preventDefault();
    const message = reviseMessage.trim();
    if (!message) return;

    setRevising(true);
    const ok = await requestPlan('/api/daily-logs/revise-plan', { message });
    if (ok) setReviseMessage('');
    setRevising(false);
  }

  const savingLabel = (s: Saving) =>
    s === 'saving' ? '保存中…' : s === 'saved' ? '已保存 ✓' : s === 'error' ? '保存失败' : '';

  return (
    <main>
      <h1>今日打卡</h1>
      <p className="subtitle">
        {date} · {weekdayLabel(date)}
      </p>

      <div className="card">
        <div className="row">
          <label style={{ marginBottom: 0 }} htmlFor="date">
            日期
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: 'auto' }}
          />
          <button className="secondary small" type="button" onClick={() => setDate(todayISO())}>
            回到今天
          </button>
        </div>
      </div>

      {error && <p className="status error">{error}</p>}
      {loading && <p className="status">加载中…</p>}

      {/* ---------- morning ---------- */}
      <form className="card" onSubmit={saveMorning}>
        <h2>早晨打卡</h2>
        <p className="hint">起床后记录体重、睡眠和状态。</p>

        <div className="grid">
          <div className="field">
            <label htmlFor="weight">体重 (kg)</label>
            <input
              id="weight"
              type="number"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="55.0"
            />
          </div>
          <div className="field">
            <label htmlFor="sleep">睡眠时长 (小时)</label>
            <input
              id="sleep"
              type="number"
              step="0.5"
              value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)}
              placeholder="7.5"
            />
          </div>
          <div className="field">
            <label htmlFor="energy">精力 (1-5)</label>
            <select id="energy" value={energy} onChange={(e) => setEnergy(e.target.value)}>
              <option value="">—</option>
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={isPeriod}
            onChange={(e) => setIsPeriod(e.target.checked)}
          />
          生理期
        </label>

        <div className="field">
          <label htmlFor="morning-note">早晨备注</label>
          <textarea
            id="morning-note"
            value={morningNote}
            onChange={(e) => setMorningNote(e.target.value)}
            placeholder="今天感觉如何？"
          />
        </div>

        <div className="row">
          <button type="submit" disabled={morningSaving === 'saving'}>
            保存早晨打卡
          </button>
          <span className="status">{savingLabel(morningSaving)}</span>
        </div>
      </form>

      {/* ---------- AI plan ---------- */}
      <section className="card">
        <h2>今日 AI 计划</h2>
        <p className="hint">根据晨间打卡、当前阶段目标和最近状态生成。</p>

        {planError && <p className="status error">{planError}</p>}

        {trainingPlan ? (
          <>
            <p className="meta">训练计划</p>
            <pre className="plan">{trainingPlan.summary}</pre>

            {/*
              Videos are resolved from ids against the library — never rendered
              from model-authored text.
            */}
            {resolveVideos(trainingPlan.video_ids, library).length > 0 && (
              <ul className="list" style={{ marginBottom: 12 }}>
                {resolveVideos(trainingPlan.video_ids, library).map((video) => (
                  <li key={video.id}>
                    <a href={video.url} target="_blank" rel="noreferrer">
                      <strong>{video.title}</strong>
                    </a>
                    <p style={{ margin: '4px 0 0' }}>
                      <span className="tag">{video.body_part}</span>
                      <span className="tag">{video.difficulty}</span>
                      <span className="meta">{video.duration_minutes} 分钟</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {trainingPlan.notes && <pre className="plan">{trainingPlan.notes}</pre>}

            <p className="meta">饮食计划</p>
            <pre className="plan">{foodPlan || '（无）'}</pre>
          </>
        ) : (
          <p className="empty" style={{ marginBottom: 12 }}>
            还没有生成今日计划。
          </p>
        )}

        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={generatePlan}
            disabled={planLoading || revising}
          >
            {planLoading ? '生成中…' : trainingPlan ? '重新生成' : '生成今日计划'}
          </button>
        </div>

        {trainingPlan && (
          <form onSubmit={revisePlan} style={{ marginTop: 14 }}>
            <label htmlFor="revise">调整计划</label>
            <div className="row">
              <input
                id="revise"
                type="text"
                value={reviseMessage}
                onChange={(e) => setReviseMessage(e.target.value)}
                placeholder="临时有变化？告诉我"
                disabled={revising || planLoading}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button type="submit" disabled={revising || planLoading || !reviseMessage.trim()}>
                {revising ? '调整中…' : '调整'}
              </button>
            </div>
            {revising && <p className="status">正在根据你的变化重新安排…</p>}
          </form>
        )}
      </section>

      {/* ---------- evening ---------- */}
      <form className="card" onSubmit={saveEvening}>
        <h2>晚间打卡</h2>
        <p className="hint">睡前记录训练完成度和一天的感受。</p>

        <div className="grid">
          <div className="field">
            <label htmlFor="training-status">训练状态</label>
            <select
              id="training-status"
              value={trainingStatus}
              onChange={(e) => setTrainingStatus(e.target.value)}
            >
              <option value="">—</option>
              {TRAINING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="felt">身体感受 (1-5)</label>
            <select id="felt" value={felt} onChange={(e) => setFelt(e.target.value)}>
              <option value="">—</option>
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="water">饮水量 (ml)</label>
            <input
              id="water"
              type="number"
              step="100"
              value={water}
              onChange={(e) => setWater(e.target.value)}
              placeholder="2000"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="evening-note">晚间备注</label>
          <textarea
            id="evening-note"
            value={eveningNote}
            onChange={(e) => setEveningNote(e.target.value)}
            placeholder="今天完成得怎么样？"
          />
        </div>

        <div className="row">
          <button type="submit" disabled={eveningSaving === 'saving'}>
            保存晚间打卡
          </button>
          <span className="status">{savingLabel(eveningSaving)}</span>
        </div>
      </form>
    </main>
  );
}
