'use client';

import { useEffect, useState } from 'react';
import Row from '@/components/Row';
import { todayISO } from '@/lib/date';
import type { Goal, PhaseDefinition } from '@/lib/types';

type PhaseDraft = { name: string; start_date: string; end_date: string; goal: string };

const emptyPhase = (): PhaseDraft => ({ name: '', start_date: '', end_date: '', goal: '' });

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [phases, setPhases] = useState<PhaseDraft[]>([emptyPhase()]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/goals');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setGoals(json.goals ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updatePhase(index: number, patch: Partial<PhaseDraft>) {
    setPhases((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const phase_definitions: PhaseDefinition[] = phases
        .filter((p) => p.name.trim() || p.goal.trim())
        .map((p) => ({
          name: p.name.trim(),
          start_date: p.start_date,
          end_date: p.end_date,
          goal: p.goal.trim(),
        }));

      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sprint_start_date: startDate,
          sprint_end_date: endDate,
          phase_definitions,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');

      setEndDate('');
      setPhases([emptyPhase()]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('删除这个 sprint？')) return;
    try {
      const res = await fetch(`/api/goals/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Delete failed');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="narrow">
      <h1>目标设置</h1>
      <p className="subtitle">Sprint & phase definitions</p>

      {error && <p className="status error">{error}</p>}

      <form className="card" onSubmit={submit}>
        <div className="sec-head">
          <h2>新建 Sprint</h2>
        </div>
        <p className="hint">先定起止日期，再往下加阶段。</p>

        <div className="fields">
        <div className="grid">
          <div className="field">
            <label htmlFor="start">开始日期</label>
            <input
              id="start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="end">结束日期</label>
            <input
              id="end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>
        </div>

        <p className="sub-head">阶段定义</p>
        {phases.map((phase, i) => (
          <div key={i} className="phase-box">
            <div className="grid">
              <div className="field">
                <label>阶段名称</label>
                <input
                  type="text"
                  value={phase.name}
                  onChange={(e) => updatePhase(i, { name: e.target.value })}
                  placeholder="第一阶段"
                />
              </div>
              <div className="field">
                <label>开始</label>
                <input
                  type="date"
                  value={phase.start_date}
                  onChange={(e) => updatePhase(i, { start_date: e.target.value })}
                />
              </div>
              <div className="field">
                <label>结束</label>
                <input
                  type="date"
                  value={phase.end_date}
                  onChange={(e) => updatePhase(i, { end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>一句话目标</label>
              <input
                type="text"
                value={phase.goal}
                onChange={(e) => updatePhase(i, { goal: e.target.value })}
                placeholder="恢复基础体能，每周三练"
              />
            </div>
            {phases.length > 1 && (
              <button
                type="button"
                className="danger small"
                onClick={() => setPhases((prev) => prev.filter((_, idx) => idx !== i))}
              >
                移除阶段
              </button>
            )}
          </div>
        ))}

        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setPhases((prev) => [...prev, emptyPhase()])}
          >
            + 添加阶段
          </button>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? '保存中…' : '保存 Sprint'}
          </button>
        </div>
      </form>

      <div className="card">
        <div className="sec-head">
          <h2>已有 Sprint</h2>
        </div>
        {loading ? (
          <p className="status">加载中…</p>
        ) : goals.length === 0 ? (
          <p className="empty">还没有 sprint。</p>
        ) : (
          <ul className="list">
            {goals.map((goal) => (
              <li key={goal.id}>
                <div className="entry-head">
                  <span className="entry-date">
                    {goal.sprint_start_date} → {goal.sprint_end_date}
                  </span>
                </div>
                {goal.phase_definitions?.length ? (
                  goal.phase_definitions.map((p, i) => (
                    <div key={i} className="phase-entry">
                      <Row
                        label={p.name || `阶段 ${i + 1}`}
                        value={`${p.start_date} → ${p.end_date}`}
                      />
                      <p className="entry-note">{p.goal}</p>
                    </div>
                  ))
                ) : (
                  <p className="empty">没有阶段定义</p>
                )}
                <div className="row entry-actions">
                  <button type="button" className="danger small" onClick={() => remove(goal.id)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
