export interface BankModel {
  id: string;
  display_name: string;
  family: string;
  family_name: string;
  response_count: number;
  valid_number_count?: number;
  counts?: number[];
  added_at?: string;
}

export interface Bank {
  schema: string;
  built_at: string;
  models: BankModel[];
  sources?: Record<string, number>;
  reference_sha256?: string;
  [key: string]: unknown;
}

export interface SequenceShape {
  autocorrelation: number;
  small_step_share: number;
  nearby_pair_share?: number;
  model_like: boolean;
}

export interface Analysis {
  prediction: string;
  prediction_name: string;
  probability: number | null;
  evidence: {
    insufficient: boolean;
    label: string;
    reason: string;
    threshold: number | null;
    method: string;
  };
  used_outputs: number;
  results: {
    model: string;
    display_name: string;
    family: string;
    family_name: string;
    probability: number | null;
    score: number;
  }[];
  diagnostics: {
    index: number;
    parsed_numbers: number;
    minimum_numbers: number;
    accepted: boolean;
  }[];
  family_prediction_name: string;
  ranking_score?: number;
  decision?: string;
  sequence?: SequenceShape | null;
  [key: string]: unknown;
}

export interface Output {
  text: string;
  expected_count: number;
}
