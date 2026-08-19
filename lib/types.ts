export type TrainingStatus = '完成' | '部分完成' | '跳过';
export const TRAINING_STATUSES: TrainingStatus[] = ['完成', '部分完成', '跳过'];

export type BodyPart =
  | 'glutes/legs'
  | 'core'
  | 'arms'
  | 'cardio'
  | 'back'
  | 'shoulders'
  | 'full_body';

export const BODY_PARTS: BodyPart[] = [
  'glutes/legs',
  'core',
  'arms',
  'cardio',
  'back',
  'shoulders',
  'full_body',
];

export type Difficulty = 'beginner' | 'intermediate';
export const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate'];

export type DailyLog = {
  /** YYYY-MM-DD */
  date: string;
  weight: number | null;
  sleep_hours: number | null;
  energy: number | null;
  training_status: TrainingStatus | null;
  felt: number | null;
  water: number | null;
  morning_note: string | null;
  evening_note: string | null;
  ai_training_plan: string | null;
  ai_food_plan: string | null;
  is_period: boolean;
};

export type PhaseDefinition = {
  name: string;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  goal: string;
};

export type Goal = {
  id: string;
  sprint_start_date: string;
  sprint_end_date: string;
  phase_definitions: PhaseDefinition[];
  created_at: string;
};

export type Video = {
  id: string;
  title: string;
  url: string;
  body_part: BodyPart;
  difficulty: Difficulty;
  duration_minutes: number;
  notes: string | null;
};

/**
 * Minimal hand-written Database type for the Supabase client.
 * Replace with `supabase gen types typescript` output once the schema settles.
 */
export type Database = {
  public: {
    Tables: {
      daily_logs: {
        Row: DailyLog;
        Insert: Partial<DailyLog> & { date: string };
        Update: Partial<DailyLog>;
        Relationships: [];
      };
      goals: {
        Row: Goal;
        Insert: Omit<Goal, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Goal>;
        Relationships: [];
      };
      video_library: {
        Row: Video;
        Insert: Omit<Video, 'id'> & { id?: string };
        Update: Partial<Video>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
