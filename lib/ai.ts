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

const MAX_REFLECTION_ATTEMPTS = 2;

/** A finished sentence ends in terminal punctuation, optionally then a closer. */
const ENDS_COMPLETE = /[。．.！!？?…]["'\u201d\u2019\u300d\u300f）)\u3011]*$/;

/**
 * Trailing decoration that carries no grammatical weight. The athlete writes
 * with emoji and the model mirrors her, so a reply may legitimately end
 * "...好好休息 \u{1F525}" — stripping these before the completeness test keeps a
 * perfectly good reply from being mistaken for a truncated one.
 */
const TRAILING_DECORATION =
  /[\s\u{FE0F}\u{200D}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}]+$/u;

/** Does this read as a finished thought, ignoring trailing emoji/whitespace? */
function isComplete(text: string): boolean {
  return ENDS_COMPLETE.test(text.replace(TRAILING_DECORATION, ''));
}

/**
 * Last-resort salvage: cut back to the final terminal punctuation so the
 * athlete gets the finished sentences rather than nothing at all. Returns null
 * if that would leave too little to be worth showing.
 */
function trimToLastCompleteSentence(text: string): string | null {
  const match = text.match(/^[\s\S]*[。．.！!？?…]["'\u201d\u2019\u300d\u300f）)\u3011]*/);
  const trimmed = match?.[0].trim();
  // A complete Chinese sentence runs ~8-12 chars, so keep the floor low.
  return trimmed && trimmed.length >= 8 ? trimmed : null;
}

const ReflectionSchema = z.object({
  reflection: z
    .string()
    .describe('2-4 sentences in 简体中文. Nothing else — no heading, no list, no sign-off.'),
});

/**
 * The tone spec is the feature here.
 *
 * The register is meant to TRACK the day, not flatten across it: warm and
 * specific when she is proud of something, deliberately restrained when the day
 * was hard or skipped. The restraint rules below are asymmetric on purpose —
 * they bind on bad days, where a stray note of judgment or pressure does real
 * damage, and loosen on good days, where holding back reads as coldness.
 */
const REFLECTION_SYSTEM_PROMPT = `你是这位运动员的训练搭档，在她一天结束时写一句简短的话。你一直在留意她这几天的状态。

用简体中文写 2-4 句话，然后停下。

## 核心原则：跟着她的情绪走

先读今晚的记录 —— 她写了什么、完成度如何、身体感受打了几分 —— 判断今天对她来说是怎样的一天，再决定用什么语气。把同一种语气套在每一天上是错的：那不是克制，那是没在听。

### 今天很好：超额完成、感受分很高、或者她写下的话里带着兴奋（感叹号、"终于"、"超额完成"）

和她一起高兴。她正为自己骄傲的时候，你的保留会显得冷淡，会错过这个时刻。

- 具体说出她做到了什么。"拉伸了 30 分钟"、"超额完成" 远远好过 "做得不错"。
- 可以有热度，可以用感叹号。
- 关于恢复、酸痛、别练太狠的提醒，最多一句，而且绝不能占据主要篇幅。今天的主角是她做成的那件事，不是明天的风险。

### 今天很难，或者她跳过了

这里才是需要克制的地方。

- 平淡地承认一句，然后把注意力放到别的地方。
- 绝不流露失望、评判或压力。不要建议明天补上、加量、把落下的追回来。不要暗示跳过的一天需要被弥补。
- 不要在她状态低的时候硬找亮点 —— 那是另一种形式的不听。

### 今天很普通

像平常那样：注意到什么就说什么，平实、温和、不着急。

## 热情要有来处

空洞的加油打气在任何一天都是错的。"加油"、"继续保持"、"坚持就是胜利"、"你真棒" 这类和今天具体发生了什么无关的话，不要写。热度必须来自她真的做成了某件事，而不是来自你想鼓励她 —— 这是"和她一起高兴"与"给她打气"的区别。

## 可以写的内容

- 直接回应今天发生的事。
- 注意到最近几天的某个规律 —— 睡眠、精力，或者她描述自己的方式。
- 把她今晚写下的东西，和她早上描述的状态联系起来。
- 给明天一个具体的小建议。

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
    '写下今晚的那几句话。',
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
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= MAX_REFLECTION_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.parse({
        model: MODEL,
        // The output is a few sentences, but adaptive thinking draws from the
        // same budget — and it thinks hardest on exactly the sensitive days
        // where a truncated half-sentence would land worst. Leave headroom.
        max_tokens: 16000,
        system: REFLECTION_SYSTEM_PROMPT,
        thinking: { type: 'adaptive' },
        output_config: {
          format: zodOutputFormat(ReflectionSchema),
          effort: 'medium',
        },
        messages: [{ role: 'user', content: buildReflectionPrompt(input) }],
      });

      // A refusal is a decision, not a glitch — retrying just burns tokens.
      if (response.stop_reason === 'refusal') {
        console.error('[ai] reflection refused', response.stop_details);
        return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
      }

      if (response.stop_reason === 'max_tokens') {
        lastProblem = 'hit max_tokens';
        continue;
      }

      const text = response.parsed_output?.reflection?.trim();
      if (!text) {
        lastProblem = `no parseable output (stop_reason: ${response.stop_reason})`;
        continue;
      }

      // Observed intermittently: stop_reason 'end_turn', valid JSON, but the
      // prose stops mid-clause. Nothing in the API surface flags it, so check
      // the text itself — a complete sentence always ends in terminal
      // punctuation. Showing nothing beats showing half a thought.
      if (!isComplete(text)) {
        lastProblem = `incomplete final sentence: ...${text.slice(-12)}`;
        // On the last attempt, keep the finished sentences instead of losing
        // the whole reply to one cut-off tail.
        if (attempt === MAX_REFLECTION_ATTEMPTS) {
          const salvaged = trimToLastCompleteSentence(text);
          if (salvaged) {
            console.warn(`[ai] reflection salvaged — dropped a truncated tail`);
            return { ok: true, reflection: salvaged };
          }
        }
        continue;
      }

      return { ok: true, reflection: text };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        console.error('[ai] reflection auth failed — check ANTHROPIC_API_KEY');
        return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
      }
      if (error instanceof Anthropic.APIError) {
        lastProblem = `API error ${error.status}: ${error.message}`;
      } else {
        lastProblem = `unexpected error: ${String(error)}`;
      }
    }
  }

  console.error(
    `[ai] reflection failed after ${MAX_REFLECTION_ATTEMPTS} attempts — ${lastProblem}`,
  );
  return { ok: false, error: REFLECTION_FAILURE_MESSAGE };
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
