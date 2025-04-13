// src/types.ts

// Define ResourceTypeString or import if defined elsewhere
export type ResourceTypeString =
    | 'video'
    | 'audio'
    | 'snippet'
    | 'json_transcript'
    | 'json_speaker_map'
    | 'text_session'
    | 'text_recap'
    | 'text_summary'
    | 'text_prompt';

export interface Resource {
    id: string;           // UUID
    original_name: string; // User-facing name
    type: ResourceTypeString;
    filename: string;      // Name on disk (e.g., uuid__uploaded.mp4)
}

export interface PipelineStep {
    id: string;
    name: string;
    inputs: ResourceTypeString[];
    output: ResourceTypeString;
    endpoint: string;
    requiresKeys?: ('assemblyAi' | 'googleGemini')[];
    multiInput?: boolean;
    inputFieldNames?: { [key in ResourceTypeString]?: string };
}

export interface PreviewContent {
    type: 'text' | 'audio' | 'video_placeholder' | 'json' | 'unsupported';
    data: string | null;
    error?: string;
}

export interface ProcessingJob {
    stepId: string;
    inputResourceIds: string[];
    apiKeys?: { assemblyAi?: string; googleGemini?: string };
    inputOriginalNames?: { [id: string]: string };
}

// Add other types if necessary