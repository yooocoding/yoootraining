import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { currentPhase, PLAN_FAILURE_MESSAGE, type DailyPlan, type PlanResult } from './plan';
import type { DailyLog, Goal, Video } from './types';

const MODEL = 'claude-sonnet-4-6';

/**
 * Structured output schema. `messages.parse()` constrains generation to this
 * shape, so we get parseable JSON without prompt-level pleading or regex.
 */
const PlanSchema = z.object({
  training_plan: z.object({
    summary: z.string().describe("One or two sentences describing today's session."),
    video_ids: z
      .array(z.string())
      .describe(
        'Ids copied verbatim from the provided video library. Empty array if no video fits.',
      ),
    notes: z
      .string()
      .describe('Practical coaching notes: order, sets/reps, intensity, things to watch.'),
  }),
  food_plan: z.string().describe('Concise meal guidance for the day.'),
});

const SYSTEM_PROMPT = `You are a personal training coach for a single athlete. Each day you produce a training plan and food guidance based on their morning check-in, their current sprint goal, and their recent history.

## Absolute constraint on videos

You will be given a VIDEO LIBRARY: a JSON array of videos, each with an "id".

- You may ONLY reference videos by copying an "id" verbatim from that array into training_plan.video_ids.
- NEVER invent a video. NEVER invent an id, a title, or a URL. NEVER put a title or URL into video_ids — ids only.
- If no video in the library fits today, return an empty video_ids array and explain the session in notes instead. An empty array is always better than a made-up id.
- Do not name specific videos in summary or notes. The app renders the real titles from the ids you return, so naming them yourself risks contradicting what the athlete sees.

## Coaching guidance

- Respect the sprint phase goal — it takes priority over variety.
- Scale to the check-in: low sleep or low energy means less volume or a deload, not the same plan with a caveat.
- On period days, favour low intensity, mobility, and lighter cardio unless the athlete says otherwise.
- Look at recent training_status and felt scores: several skipped days means rebuild gently; consistently high felt scores means it is safe to progress.
- Avoid hammering the same body part on consecutive days.
- Be concrete and brief. Write summary and notes in Chinese (简体中文), matching how the athlete writes their own notes.`;

export type AiPlanInput = {
  /** Today's log so far (morning check-in), if any. */
  log: DailyLog | null;
  /** The active sprint, if any. */
  goal: Goal | null;
  /** The full curated library — the only videos the model may reference. */
  videos: Video[];
  /** Recent history for context, newest first. */
  recentLogs: DailyLog[];
  /** The date being planned, YYYY-MM-DD. */
  date: string;
  /**
   * Revision mode: the plan currently saved for this day, plus what changed.
   * When present the model revises rather than starting over.
   */
  revision?: {
    currentPlan: DailyPlan | null;
    message: string;
  };
};

function buildUserPrompt(input: AiPlanInput): string {
  const { log, goal, videos, recentLogs, date, revision } = input;
  const phase = currentPhase(goal, date);

  const sections: string[] = [];

  sections.push(`## 日期\n${date}`);

  sections.push(
    `## 今日晨间打卡\n${
      log
        ? JSON.stringify(
            {
              weight: log.weight,
              sleep_hours: log.sleep_hours,
              energy: log.energy,
              morning_note: log.morning_note,
              is_period: log.is_period,
            },
            null,
            2,
          )
        : '（今天还没有打卡数据）'
    }`,
  );

  sections.push(
    `## 当前阶段目标\n${
      phase
        ? JSON.stringify(phase, null, 2)
        : goal
          ? `Sprint ${goal.sprint_start_date} → ${goal.sprint_end_date}（今天不在任何已定义的阶段区间内）`
          : '（还没有设定 sprint）'
    }`,
  );

  sections.push(
    `## 最近 7 天\n${
      recentLogs.length
        ? JSON.stringify(
            recentLogs.map((l) => ({
              date: l.date,
              training_status: l.training_status,
              felt: l.felt,
              energy: l.energy,
              sleep_hours: l.sleep_hours,
              is_period: l.is_period,
              evening_note: l.evening_note,
            })),
            null,
            2,
          )
        : '（没有历史记录）'
    }`,
  );

  sections.push(
    `## VIDEO LIBRARY — the only videos you may reference\n${JSON.stringify(
      videos.map((v) => ({
        id: v.id,
        title: v.title,
        body_part: v.body_part,
        difficulty: v.difficulty,
        duration_minutes: v.duration_minutes,
        notes: v.notes,
      })),
      null,
      2,
    )}`,
  );

  if (revision) {
    sections.push(
      `## 当前已生成的计划\n${
        revision.currentPlan ? JSON.stringify(revision.currentPlan, null, 2) : '（还没有计划）'
      }`,
    );
    sections.push(
      `## 临时变化（来自运动员本人）\n${revision.message}\n\n` +
        '请在保留原计划意图的前提下调整以适应这个变化。只改需要改的部分。',
    );
  } else {
    sections.push('请生成今天的训练计划和饮食建议。');
  }

  return sections.join('\n\n');
}

/**
 * Drop any id the model returned that isn't in the library we passed it.
 * Degrades rather than throwing: an invalid suggestion is omitted, the rest of
 * the plan still reaches the athlete.
 */
function validateVideoIds(
  plan: DailyPlan,
  videos: Video[],
): { plan: DailyPlan; dropped: string[] } {
  const known = new Set(videos.map((v) => v.id));
  const kept: string[] = [];
  const dropped: string[] = [];

  for (const id of plan.training_plan.video_ids) {
    // De-dupe as well — a repeated id would render the same video twice.
    if (known.has(id)) {
      if (!kept.includes(id)) kept.push(id);
    } else {
      dropped.push(id);
    }
  }

  return {
    plan: { ...plan, training_plan: { ...plan.training_plan, video_ids: kept } },
    dropped,
  };
}

/**
 * Generate (or revise) a day's plan. Never throws — on any failure it returns
 * `{ ok: false }` so the caller can show a retry state instead of a 500.
 */
export async function generateDailyPlan(input: AiPlanInput): Promise<PlanResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[ai] ANTHROPIC_API_KEY is not set');
    return { ok: false, error: PLAN_FAILURE_MESSAGE };
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: {
        format: zodOutputFormat(PlanSchema),
        effort: 'medium',
      },
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    if (response.stop_reason === 'refusal') {
      console.error('[ai] request refused', response.stop_details);
      return { ok: false, error: PLAN_FAILURE_MESSAGE };
    }

    // parsed_output is null if the model failed to satisfy the schema.
    const parsed = response.parsed_output;
    if (!parsed) {
      console.error('[ai] no parseable structured output', {
        stop_reason: response.stop_reason,
      });
      return { ok: false, error: PLAN_FAILURE_MESSAGE };
    }

    const { plan, dropped } = validateVideoIds(parsed, input.videos);

    if (dropped.length) {
      console.warn(
        `[ai] dropped ${dropped.length} hallucinated video id(s) not in video_library:`,
        dropped,
      );
    }

    return { ok: true, plan, dropped_video_ids: dropped };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('[ai] authentication failed — check ANTHROPIC_API_KEY');
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error('[ai] rate limited');
    } else if (error instanceof Anthropic.APIError) {
      console.error(`[ai] API error ${error.status}:`, error.message);
    } else {
      console.error('[ai] unexpected error:', error);
    }
    return { ok: false, error: PLAN_FAILURE_MESSAGE };
  }
}
