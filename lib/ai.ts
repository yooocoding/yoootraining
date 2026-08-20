import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import {
  currentPhase,
  parseTrainingPlan,
  PLAN_FAILURE_MESSAGE,
  REFLECTION_FAILURE_MESSAGE,
  type DailyPlan,
  type PlanResult,
} from './plan';
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

const ReflectionSchema = z.object({
  reflection: z
    .string()
    .describe('2-3 sentences in 简体中文. Nothing else — no heading, no list, no sign-off.'),
});

/**
 * The tone spec is the feature here. Read the negative constraints as hard
 * requirements, not style preferences: this note is shown on days the athlete
 * skipped everything, and it must read the same on those days as on any other.
 */
const REFLECTION_SYSTEM_PROMPT = `你是这位运动员的训练搭档，在她一天结束时写一句简短的话。你一直在留意她这几天的状态。

用简体中文写 2-3 句话，然后停下。克制本身就是重点 —— 短而安静的一段话，永远好过面面俱到的一段话。

## 这不是什么

这不是复盘，也不是评价。你不是在给这一天打分。

- 绝不因为完成训练而表扬，也绝不因为跳过训练而流露失望、担心或鼓励。无论她今天全部完成还是完全没动，你的语气必须完全一致 —— 读的人不应该能从你的语气里判断出是哪一种。
- 如果今天跳过或只完成了一部分：平淡地带过一句，然后把注意力放到别的地方。不要建议明天补上、加量、把进度追回来、重新开始。不要暗示跳过的一天需要被弥补。
- 不要使用任何感叹号。
- 禁止出现：加油、太棒了、继续保持、真不错、做得好、很棒、厉害、坚持就是胜利，以及任何类似的加油打气。不提连续天数，不庆祝，不做励志式表达。

## 应该写什么

从下面三件事里挑一件，把它写好就够了：
- 注意到最近几天的某个规律 —— 睡眠、精力，或者她描述自己的方式。
- 把她今晚写下的东西，和她早上描述的状态联系起来。
- 给明天一个具体的小建议。

像训练搭档在一天结束时发消息那样写：平实、留意到了、不着急。

## 硬性限制

- 绝不提体重、体重数字，或体重的任何变化方向。一次都不行，任何说法都不行。
- 如果她提到身体不适，或者听起来情绪低落：平实地表达关心。不要诊断，不要说出任何病症名称，不要建议任何治疗、补剂、药物，也不要建议去看医生。就像一个人那样，承认它就好。
- 不给任何医疗建议。
- 不要提具体的视频名称。`;

export type EveningReflectionInput = {
  /** Today's row, after the evening check-in has been saved. */
  log: DailyLog;
  /** The few days before today, newest first. */
  recentLogs: DailyLog[];
};

export type ReflectionResult =
  | { ok: true; reflection: string }
  | { ok: false; error: string };

function buildReflectionPrompt(input: EveningReflectionInput): string {
  const { log, recentLogs } = input;

  const training = parseTrainingPlan(log.ai_training_plan);

  const sections = [
    `## 今天 (${log.date})`,
    JSON.stringify(
      {
        // Deliberately no weight field — the model must never see it.
        sleep_hours: log.sleep_hours,
        energy: log.energy,
        morning_note: log.morning_note,
        is_period: log.is_period,
        training_status: log.training_status,
        felt: log.felt,
        water: log.water,
        evening_note: log.evening_note,
      },
      null,
      2,
    ),
    '## 今天给她的计划',
    training
      ? JSON.stringify({ summary: training.summary, notes: training.notes }, null, 2)
      : '（今天没有生成计划）',
    '## 之前几天',
    recentLogs.length
      ? JSON.stringify(
          recentLogs.map((l) => ({
            date: l.date,
            training_status: l.training_status,
            felt: l.felt,
            energy: l.energy,
            sleep_hours: l.sleep_hours,
            is_period: l.is_period,
            morning_note: l.morning_note,
            evening_note: l.evening_note,
          })),
          null,
          2,
        )
      : '（没有更早的记录）',
    '写下今晚的那 2-3 句话。',
  ];

  return sections.join('\n\n');
}

/**
 * Generate the end-of-day note. Never throws — a failure here must never
 * affect the evening check-in, which has already been saved by this point.
 */
export async function generateEveningReflection(
  input: EveningReflectionInput,
): Promise<ReflectionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[ai] ANTHROPIC_API_KEY is not set');
    return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: MODEL,
      // The output is 2-3 sentences, but adaptive thinking draws from the same
      // budget — and it thinks hardest on exactly the sensitive days where a
      // truncated half-sentence would land worst. Leave real headroom.
      max_tokens: 16000,
      system: REFLECTION_SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: {
        format: zodOutputFormat(ReflectionSchema),
        effort: 'medium',
      },
      messages: [{ role: 'user', content: buildReflectionPrompt(input) }],
    });

    if (response.stop_reason === 'refusal') {
      console.error('[ai] reflection refused', response.stop_details);
      return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
    }

    // Better to show nothing than a sentence that stops halfway.
    if (response.stop_reason === 'max_tokens') {
      console.error('[ai] reflection truncated at max_tokens');
      return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
    }

    const text = response.parsed_output?.reflection?.trim();
    if (!text) {
      console.error('[ai] no parseable reflection', { stop_reason: response.stop_reason });
      return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
    }

    return { ok: true, reflection: text };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`[ai] reflection API error ${error.status}:`, error.message);
    } else {
      console.error('[ai] reflection unexpected error:', error);
    }
    return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
  }
}

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

    // A half-written plan is worse than none — don't save it over a good one.
    if (response.stop_reason === 'max_tokens') {
      console.error('[ai] plan truncated at max_tokens');
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
