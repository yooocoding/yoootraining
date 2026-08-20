'use client';

import { useCallback, useEffect, useState } from 'react';
import { todayISO, weekdayLabel } from '@/lib/date';
import Row from '@/components/Row';
import { currentPhase, parseTrainingPlan, resolveVideos, type TrainingPlan } from '@/lib/plan';
import { TRAINING_STATUSES, type DailyLog, type Goal, type Video } from '@/lib/types';

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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);
  const [foodPlan, setFoodPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [reviseMessage, setReviseMessage] = useState('');
  const [revising, setRevising] = useState(false);

  // evening reflection
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflectionLoading, setReflectionLoading] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);

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
    setReflection(next?.ai_evening_reflection ?? null);
    setReflectionError(null);
  }, []);

  // The video library is the lookup table for AI-suggested video_ids. Loaded
  // once: ids are only ever rendered by resolving them against this list.
  useEffect(() => {
    fetch('/api/videos')
      .then((res) => res.json())
      .then((json) => setLibrary(json.videos ?? []))
      .catch(() => setLibrary([]));

    // Sprints, for the phase line in the record header.
    fetch('/api/goals')
      .then((res) => res.json())
      .then((json) => setGoals(json.goals ?? []))
      .catch(() => setGoals([]));
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
      return true;
    } catch (err) {
      setSaving('error');
      setError((err as Error).message);
      return false;
    }
  }

  /**
   * Runs only after the evening check-in has already been saved, and keeps its
   * own error state — a failure here must never look like a failed save.
   */
  async function requestReflection() {
    setReflectionLoading(true);
    setReflectionError(null);
    try {
      const res = await fetch('/api/daily-logs/evening-reflection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const json = await res.json();
      if (json.ok) {
        setReflection(json.reflection);
      } else {
        setReflectionError(json.error ?? '打卡已保存，今晚的回应没能生成。');
      }
    } catch {
      setReflectionError('打卡已保存，今晚的回应没能生成。');
    } finally {
      setReflectionLoading(false);
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

  async function saveEvening(e: React.FormEvent) {
    e.preventDefault();
    const saved = await save(
      {
        training_status: (trainingStatus || null) as DailyLog['training_status'],
        felt: num(felt),
        water: num(water),
        evening_note: eveningNote.trim() || null,
      },
      setEveningSaving,
    );
    // Only after the save has landed, and never gating it.
    if (saved) requestReflection();
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

  // Success and failure both get the stamp colour — the only colour on the page.
  const statusClass = (s: Saving) =>
    s === 'saved' ? 'status ok' : s === 'error' ? 'status error' : 'status';

  // The sprint covering the selected date, and the phase inside it.
  const activeGoal =
    goals.find((g) => g.sprint_start_date <= date && date <= g.sprint_end_date) ?? null;
  const phase = currentPhase(activeGoal, date);

  return (
    <main>
      <h1>今日打卡</h1>
      <p className="subtitle">Daily check-in record</p>

      {/* ---------- record card header ---------- */}
      <header className="record">
        <div className="record__row">
          <span className="record__label">日期</span>
          <span className="record__value">
            {date} · {weekdayLabel(date)}
          </span>
        </div>
        <div className="record__row">
          <span className="record__label">阶段</span>
          <span className={phase ? 'record__value' : 'record__value muted'}>
            {phase ? `${phase.name || '当前阶段'} — ${phase.goal}` : '未设定阶段'}
          </span>
        </div>
      </header>

      <div className="card">
        <div className="fields">
          <div className="field">
            <label htmlFor="date">选择日期</label>
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <button className="secondary" type="button" onClick={() => setDate(todayISO())}>
          回到今天
        </button>
      </div>

      {error && <p className="status error">{error}</p>}
      {loading && <p className="status">加载中…</p>}

      {/*
        Two independent columns. Left is the writing side, right the reading
        side; each stacks from the top. Below 860px the wrappers dissolve via
        display:contents and CSS `order` restores morning -> plan -> evening
        -> reflection.
      */}
      <div className="today-grid">
      <div className="today-col">
      {/* ---------- morning ---------- */}
      <form className="card zone-morning" onSubmit={saveMorning}>
        <div className="sec-head">
          <h2>早晨打卡</h2>
        </div>
        <p className="hint">起床后记录体重、睡眠和状态。</p>

        <div className="fields">
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
        </div>

        <div className="actions">
          <button className="primary" type="submit" disabled={morningSaving === 'saving'}>
            保存早晨打卡
          </button>
          <span className={statusClass(morningSaving)}>{savingLabel(morningSaving)}</span>
        </div>
      </form>

      {/* ---------- evening ---------- */}
      <form className="card zone-evening" onSubmit={saveEvening}>
        <div className="sec-head">
          <h2>晚间打卡</h2>
        </div>
        <p className="hint">睡前记录训练完成度和一天的感受。</p>

        <div className="fields">
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
        </div>

        <div className="actions">
          <button className="primary" type="submit" disabled={eveningSaving === 'saving'}>
            保存晚间打卡
          </button>
          <span className={statusClass(eveningSaving)}>{savingLabel(eveningSaving)}</span>
        </div>
      </form>
      </div>

      <div className="today-col">

      {/* ---------- AI plan ---------- */}
      <section className="card zone-plan">
        <div className="sec-head">
          <h2>今日 AI 计划</h2>
        </div>
        <p className="hint">根据晨间打卡、当前阶段目标和最近状态生成。</p>

        {planError && <p className="status error">{planError}</p>}

        {trainingPlan ? (
          <>
            <p className="sub-head">训练计划</p>
            <pre className="plan">{trainingPlan.summary}</pre>

            {/*
              Videos are resolved from ids against the library — never rendered
              from model-authored text.
            */}
            {resolveVideos(trainingPlan.video_ids, library).length > 0 && (
              <ul className="list plan-videos">
                {resolveVideos(trainingPlan.video_ids, library).map((video) => (
                  <li key={video.id}>
                    <a className="entry-title" href={video.url} target="_blank" rel="noreferrer">
                      {video.title}
                    </a>
                    <Row
                      label={`${video.body_part} / ${video.difficulty}`}
                      value={`${video.duration_minutes} 分钟`}
                    />
                  </li>
                ))}
              </ul>
            )}

            {trainingPlan.notes && <pre className="plan">{trainingPlan.notes}</pre>}

            <p className="sub-head">饮食计划</p>
            <pre className="plan">{foodPlan || '（无）'}</pre>
          </>
        ) : (
          <p className="empty">还没有生成今日计划。</p>
        )}

        <div className="actions">
          {/* Primary only while there is no plan yet — a regenerate is secondary. */}
          <button
            type="button"
            className={trainingPlan ? 'secondary' : 'primary'}
            onClick={generatePlan}
            disabled={planLoading || revising}
          >
            {planLoading ? '生成中…' : trainingPlan ? '重新生成' : '生成今日计划'}
          </button>
        </div>

        {trainingPlan && (
          <form onSubmit={revisePlan} className="revise">
            <label htmlFor="revise">调整计划</label>
            <div className="row">
              <input
                id="revise"
                type="text"
                value={reviseMessage}
                onChange={(e) => setReviseMessage(e.target.value)}
                placeholder="临时有变化？告诉我"
                disabled={revising || planLoading}
                className="revise__input"
              />
              <button
                type="submit"
                className="primary compact"
                disabled={revising || planLoading || !reviseMessage.trim()}
              >
                {revising ? '调整中…' : '调整'}
              </button>
            </div>
            {revising && <p className="status">正在根据你的变化重新安排…</p>}
          </form>
        )}
      </section>


      {/*
        Sits directly under the plan in the reading column, independent of how
        tall the writing column is. On mobile CSS `order` drops it last.
        Renders nothing until there is something to say.
      */}
      {(reflection || reflectionLoading || reflectionError) && (
        <section className="card zone-reflection">
          <div className="sec-head">
            <h2>今晚</h2>
          </div>
          {reflectionLoading ? (
            <p className="status">正在写…</p>
          ) : reflectionError ? (
            <p className="empty">{reflectionError}</p>
          ) : (
            <p className="reflection">{reflection}</p>
          )}
        </section>
      )}
      </div>
      </div>
    </main>
  );
}
