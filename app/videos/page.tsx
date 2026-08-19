'use client';

import { useEffect, useState } from 'react';
import Row from '@/components/Row';
import { BODY_PARTS, DIFFICULTIES, type BodyPart, type Difficulty, type Video } from '@/lib/types';

type Draft = {
  title: string;
  url: string;
  body_part: BodyPart;
  difficulty: Difficulty;
  duration_minutes: string;
  notes: string;
};

const emptyDraft = (): Draft => ({
  title: '',
  url: '',
  body_part: 'glutes/legs',
  difficulty: 'beginner',
  duration_minutes: '',
  notes: '',
});

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/videos');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setVideos(json.videos ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(video: Video) {
    setEditingId(video.id);
    setDraft({
      title: video.title,
      url: video.url,
      body_part: video.body_part,
      difficulty: video.difficulty,
      duration_minutes: String(video.duration_minutes),
      notes: video.notes ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...draft,
        duration_minutes: Number(draft.duration_minutes) || 0,
        notes: draft.notes.trim() || null,
      };
      const res = await fetch(editingId ? `/api/videos/${editingId}` : '/api/videos', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      cancelEdit();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('删除这个视频？')) return;
    try {
      const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Delete failed');
      if (editingId === id) cancelEdit();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="narrow">
      <h1>视频库</h1>
      <p className="subtitle">Curated training video index</p>

      {error && <p className="status error">{error}</p>}

      <form className="card" onSubmit={submit}>
        <div className="sec-head">
          <h2>{editingId ? '编辑视频' : '添加视频'}</h2>
        </div>
        <p className="hint">AI 生成计划时只会从这个列表里挑选。</p>

        <div className="fields">
        <div className="field">
          <label htmlFor="title">标题</label>
          <input
            id="title"
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="url">链接</label>
          <input
            id="url"
            type="url"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://…"
            required
          />
        </div>

        <div className="grid">
          <div className="field">
            <label htmlFor="body-part">部位</label>
            <select
              id="body-part"
              value={draft.body_part}
              onChange={(e) => setDraft({ ...draft, body_part: e.target.value as BodyPart })}
            >
              {BODY_PARTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="difficulty">难度</label>
            <select
              id="difficulty"
              value={draft.difficulty}
              onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as Difficulty })}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="duration">时长 (分钟)</label>
            <input
              id="duration"
              type="number"
              min="0"
              value={draft.duration_minutes}
              onChange={(e) => setDraft({ ...draft, duration_minutes: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">备注</label>
          <textarea
            id="notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
        </div>

        <div className="actions">
          <button className="primary" type="submit" disabled={saving}>
            {saving ? '保存中…' : editingId ? '保存修改' : '添加'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={cancelEdit}>
              取消
            </button>
          )}
        </div>
      </form>

      <div className="card">
        <div className="sec-head">
          <h2>全部视频 ({videos.length})</h2>
        </div>
        {loading ? (
          <p className="status">加载中…</p>
        ) : videos.length === 0 ? (
          <p className="empty">还没有视频。</p>
        ) : (
          <ul className="list">
            {videos.map((video) => (
              <li key={video.id}>
                <a className="entry-title" href={video.url} target="_blank" rel="noreferrer">
                  {video.title}
                </a>
                <Row label={video.body_part} value={`${video.duration_minutes} 分钟`} />
                <Row label="难度" value={video.difficulty} />
                {video.notes && <p className="entry-note">{video.notes}</p>}
                <div className="row entry-actions">
                  <button type="button" className="secondary small" onClick={() => startEdit(video)}>
                    编辑
                  </button>
                  <button type="button" className="danger small" onClick={() => remove(video.id)}>
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
