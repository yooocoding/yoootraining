import 'server-only';

import { createServerClient } from './supabase';
import { generateDailyPlan, type AiPlanInput } from './ai';
import { parseTrainingPlan, type DailyPlan, type PlanResult } from './plan';
import type { DailyLog, Goal, Video } from './types';

export type PlanContext = {
  log: DailyLog | null;
  goal: Goal | null;
  videos: Video[];
  recentLogs: DailyLog[];
  /** The plan already saved for this date, if any. */
  currentPlan: DailyPlan | null;
};

/**
 * Everything the model needs for one day, in a single round of parallel reads.
 * Shared by generate-plan and revise-plan so the two can't drift apart.
 */
export async function loadPlanContext(date: string): Promise<PlanContext> {
  const supabase = createServerClient();

  const [logRes, goalRes, videosRes, recentRes] = await Promise.all([
    supabase.from('daily_logs').select('*').eq('date', date).maybeSingle(),
    supabase
      .from('goals')
      .select('*')
      .lte('sprint_start_date', date)
      .gte('sprint_end_date', date)
      .order('sprint_start_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('video_library').select('*').order('title'),
    supabase
      .from('daily_logs')
      .select('*')
      .lt('date', date)
      .order('date', { ascending: false })
      .limit(7),
  ]);

  const firstError = logRes.error ?? goalRes.error ?? videosRes.error ?? recentRes.error;
  if (firstError) throw new Error(firstError.message);

  const log = logRes.data ?? null;
  const training = parseTrainingPlan(log?.ai_training_plan);

  return {
    log,
    goal: goalRes.data ?? null,
    videos: videosRes.data ?? [],
    recentLogs: recentRes.data ?? [],
    currentPlan: training
      ? { training_plan: training, food_plan: log?.ai_food_plan ?? '' }
      : null,
  };
}

/**
 * Run the model and persist the result.
 *
 * `ai_training_plan` stores the training_plan object as JSON (summary +
 * validated video_ids + notes); `ai_food_plan` stores the food text. Keeping
 * the ids in JSON is what lets the frontend re-resolve them to real videos on
 * every page load instead of trusting rendered text.
 *
 * On failure nothing is written — the previous plan survives.
 */
export async function runAndSavePlan(
  date: string,
  context: PlanContext,
  revision?: AiPlanInput['revision'],
): Promise<PlanResult> {
  const result = await generateDailyPlan({
    log: context.log,
    goal: context.goal,
    videos: context.videos,
    recentLogs: context.recentLogs,
    date,
    revision,
  });

  if (!result.ok) return result;

  const supabase = createServerClient();
  const { error } = await supabase.from('daily_logs').upsert(
    {
      date,
      ai_training_plan: JSON.stringify(result.plan.training_plan),
      ai_food_plan: result.plan.food_plan,
    },
    { onConflict: 'date' },
  );

  if (error) {
    console.error('[plan] generated but failed to save:', error.message);
    return { ok: false, error: '计划已生成但保存失败，请重试。' };
  }

  return result;
}
