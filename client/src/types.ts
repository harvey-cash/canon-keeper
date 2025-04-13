// src/types.ts (or keep within App.tsx if preferred for now)

export type ResourceTypeString =
    | 'video'
    | 'audio'
    | 'json_transcript'
    | 'snippet'
    | 'json_speaker_map'
    | 'text_session'
    | 'text_prompt'
    | 'text_recap'
    | 'text_summary';

export interface Resource {
    id: string;
    type: ResourceTypeString;
    filename: string;
    original_name: string;
    created_at: string; // Consider using Date type after fetching
    metadata?: { [key: string]: any };
}

export interface PipelineStep {
    id: string;
    name: string;
    inputs: ResourceTypeString[];
    output: ResourceTypeString; // Or potentially multiple for some steps?
    endpoint: string;
    requiresKeys?: Array<'assemblyAi' | 'googleGemini'>;
    multiInput?: boolean; // Indicates multiple inputs need to be grouped (e.g., audio + transcript)
    inputFieldNames?: { [key in ResourceTypeString]?: string }; // Map input type to backend field name
    sequence?: string[]; // *** NEW: Defines sequence for meta-steps ***
}

export type PreviewDataType = string | null; // Can be text, JSON string, or URL

export interface PreviewContent {
    type: 'text' | 'json' | 'audio' | 'video_placeholder' | 'unsupported';
    data: PreviewDataType;
    error?: string;
}

export interface ProcessingJob {
    stepId: string; // The ID of the *actual* step being executed
    inputResourceIds: string[];
    apiKeys?: { assemblyAi?: string; googleGemini?: string };
    inputOriginalNames: { [id: string]: string }; // For display/debugging
    // --- Sequence Tracking ---
    metaStepId?: string; // The ID of the parent meta-step (e.g., 'video_to_snippets')
    sequenceSteps?: string[]; // The full sequence defined by the meta-step
    currentSequenceIndex?: number; // The index *of the step currently being processed* within sequenceSteps
    originalInputResourceIds?: string[]; // The very first resource(s) that started the sequence
}
