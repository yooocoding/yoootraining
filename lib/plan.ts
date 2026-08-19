import type { Goal, PhaseDefinition, Video } from './types';

/**
 * Shape the model is required to return, and the shape we persist.
 * Client-safe: this module must not import the Anthropic SDK — the today page
 * imports it to resolve video_ids for rendering.
 */
export type TrainingPlan = {
  summary: string;
  /** Ids into video_library. Always validated against the library before use. */
  video_ids: string[];
  notes: string;
};

export type DailyPlan = {
  training_plan: TrainingPlan;
  food_plan: string;
};

export type PlanResult =
  | { ok: true; plan: DailyPlan; dropped_video_ids: string[] }
  | { ok: false; error: string };

/** User-facing message for the degraded state. Never throws to the page. */
export const PLAN_FAILURE_MESSAGE = '计划生成失败了，请稍后再试。';

/**
 * Read `ai_training_plan` back out of the database.
 *
 * The column holds JSON, but tolerate anything else: rows written by the old
 * mock generator hold plain text, and a half-written value should degrade to
 * "show it as the summary" rather than blanking the page.
 */
export function parseTrainingPlan(raw: string | null | undefined): TrainingPlan | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'summary' in parsed) {
      const p = parsed as Partial<TrainingPlan>;
      return {
        summary: typeof p.summary === 'string' ? p.summary : '',
        video_ids: Array.isArray(p.video_ids)
          ? p.video_ids.filter((id): id is string => typeof id === 'string')
          : [],
        notes: typeof p.notes === 'string' ? p.notes : '',
      };
    }
  } catch {
    // not JSON — fall through to the legacy plain-text path
  }

  return { summary: raw, video_ids: [], notes: '' };
}

/**
 * Resolve ids to real Video rows. Ids with no match are dropped — the UI never
 * renders model-authored video text, only rows that exist in the library.
 */
export function resolveVideos(videoIds: string[], library: Video[]): Video[] {
  const byId = new Map(library.map((v) => [v.id, v]));
  return videoIds.map((id) => byId.get(id)).filter((v): v is Video => v !== undefined);
}

/** The phase of `goal` whose date range contains `date`, else null. */
export function currentPhase(goal: Goal | null, date: string): PhaseDefinition | null {
  if (!goal?.phase_definitions?.length) return null;
  return (
    goal.phase_definitions.find(
      (p) => p.start_date && p.end_date && p.start_date <= date && date <= p.end_date,
    ) ?? null
  );
}
