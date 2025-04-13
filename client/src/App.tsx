// client/src/App.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { FiAlertTriangle, FiLoader, FiInfo, FiFastForward } from 'react-icons/fi'; // Added FiFastForward

// Import the new components
import { ResourcesPanel } from './components/ResourcesPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { PipelinePanel } from './components/PipelinePanel';

// Import types (assuming they are in src/types.ts)
import { Resource, ResourceTypeString, PipelineStep, PreviewContent, ProcessingJob, PausedSequenceInfo } from './types'; // Ensure path is correct

// --- Constants ---
const API_BASE_URL = 'http://127.0.0.1:8000';
const ACCEPTED_FILE_TYPES = ".mp4,.mov,.avi,.mkv,.webm,.mp3,.wav,.ogg,.m4a,.flac,.json,.txt";

// --- Pipeline Definition ---
// *** ADD THE NEW META-STEP AT THE TOP ***
const PIPELINE_STEPS: PipelineStep[] = [
    {
        id: 'meta_video_to_recap', // New ID
        name: '🎬 Video to Recap', // New Name
        inputs: ['video', 'text_prompt'],        // Initial input
        output: 'text_recap',     // Final output
        endpoint: '',
        sequence: [               // New sequence
            'video_to_audio',
            'audio_to_transcript',
            'transcript_to_snippets', // Pause happens after this
            'transcript_to_session',  // Resumes here
            'session_to_recap'        // Continues here
        ],
    },
    {
        id: 'video_to_audio', name: '1. Video to Audio', inputs: ['video'], output: 'audio', endpoint: '/process/video_to_audio',
        inputFieldNames: { video: 'video_id' }
    },
    {
        id: 'audio_to_transcript', name: '2. Audio to Transcript', inputs: ['audio'], output: 'json_transcript', endpoint: '/process/audio_to_transcript', requiresKeys: ['assemblyAi'],
        inputFieldNames: { audio: 'audio_id' }
    },
    {
        id: 'transcript_to_snippets', name: '3. Transcript to Snippets', inputs: ['audio', 'json_transcript'], output: 'snippet', endpoint: '/process/transcript_to_snippets', multiInput: true,
        inputFieldNames: { audio: 'audio_id', json_transcript: 'transcript_id' }
    },
    {
        id: 'transcript_to_session', name: '4. Transcript to Session', inputs: ['json_transcript', 'json_speaker_map'], output: 'text_session', endpoint: '/process/transcript_to_session', multiInput: true,
        inputFieldNames: { json_transcript: 'transcript_id', json_speaker_map: 'speaker_map_id' }
    },
    {
        id: 'session_to_recap', name: '5. Session to Recap', inputs: ['text_session', 'text_prompt'], output: 'text_recap', endpoint: '/process/session_to_recap', requiresKeys: ['googleGemini'], multiInput: true,
        inputFieldNames: { text_session: 'text_session_id', text_prompt: 'prompt_id' }
    },
    {
        id: 'recap_to_summary', name: '6. Recap to Summary', inputs: ['text_recap', 'text_prompt'], output: 'text_summary', endpoint: '/process/recap_to_summary', requiresKeys: ['googleGemini'], multiInput: true,
        inputFieldNames: { text_recap: 'text_recap_id', text_prompt: 'prompt_id' }
    },
];

// --- API Helper Functions (keep as is) ---
async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // ... same as before ...
    const url = `${API_BASE_URL}${endpoint}`;
    let response: Response | null = null;
    try {
        response = await fetch(url, {
            ...options,
            headers: {
                Accept: 'application/json',
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            let errorDetail = `HTTP error! Status: ${response.status} ${response.statusText}`;
            let errorJson: any = null;
            try {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    errorJson = await response.json();
                    errorDetail = errorJson.detail || JSON.stringify(errorJson) || errorDetail;
                } else {
                    const textError = await response.text();
                    errorDetail = textError || errorDetail;
                }

            } catch (e) {
                console.warn("Could not parse error response body:", e)
            }
            console.error(`API Error Response (${url}):`, errorDetail, errorJson);
            throw new Error(errorDetail);
        }

        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return null as T;
        }

        return response.json() as Promise<T>;

    } catch (error) {
        console.error(`API Fetch Error (${url}):`, error);
        if (error instanceof Error) {
            throw error;
        } else {
            throw new Error(String(error));
        }
    }
}

// --- Utility Functions ---
const getBaseNameForComparison = (filename: string | undefined): string => {
    // ... same as before ...
    if (!filename) return '';
    return filename
        .replace('_audio', '')
        .replace('_transcript', '')
        .replace('_session_script', '')
        .replace('_recap', '')
        .replace('_summary', '')
        .replace('_prompt', '')
        .replace('_snippet', '')
        .replace(/_speaker_[A-Z]/i, '')
        .replace('_speaker_map', '')
        .replace(/\.\w+$/, '');
};

const tryFormatJson = (jsonString: string | null): string => {
    if (!jsonString) return '';
    try {
        return JSON.stringify(JSON.parse(jsonString), null, 2);
    } catch {
        return jsonString;
    }
};

namespace Path {
    export function stem(filename: string): string { const parts = filename.split('.'); if (parts.length > 1) parts.pop(); return parts.join('.'); }
    export function extname(filename: string): string { const parts = filename.split('.'); return parts.length > 1 ? '.' + parts.pop() : ''; }
}

// --- Main App Component ---
function App() {
    // --- State Declarations (keep as is) ---
    const [resources, setResources] = useState<Resource[]>([]);
    const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
    const [previewContent, setPreviewContent] = useState<{ [id: string]: PreviewContent }>({});
    const [isLoadingResources, setIsLoadingResources] = useState(true);
    const [isLoadingPreview, setIsLoadingPreview] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [stepErrors, setStepErrors] = useState<{ [stepId: string]: string | null }>({});
    const [apiKeys, setApiKeys] = useState<{ assemblyAi?: string; googleGemini?: string }>({});
    const [processingQueue, setProcessingQueue] = useState<ProcessingJob[]>([]);
    const [currentlyProcessing, setCurrentlyProcessing] = useState<ProcessingJob | null>(null);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
    const [showSpeakerMapForm, setShowSpeakerMapForm] = useState(false);
    const [snippetsForMapping, setSnippetsForMapping] = useState<Resource[]>([]);
    const [speakerMapInput, setSpeakerMapInput] = useState<{ [label: string]: string }>({});
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [pausedSequenceData, setPausedSequenceData] = useState<PausedSequenceInfo | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Data Fetching & Logic Callbacks ---
    const fetchResources = useCallback(async (selectIds: string[] = []) => { // Allow passing IDs to select
        setIsLoadingResources(true);
        let newlyFetchedResources: Resource[] = [];
        try {
            const data = await fetchApi<Resource[]>('/resources');
            newlyFetchedResources = data || [];
            setResources(newlyFetchedResources);
            if (selectIds.length > 0) {
                setSelectedResourceIds(prev => new Set([...Array.from(prev), ...selectIds]));
            }
        } catch (err: any) {
            setError(`Failed to fetch resources: ${err.message}`);
            setResources([]); // Clear resources on fetch error
            setSelectedResourceIds(new Set()); // Clear selection as well
        } finally {
            setIsLoadingResources(false);
        }
        return newlyFetchedResources; // Return fetched data for chaining
    }, []); // No dependencies needed here, it's self-contained

    useEffect(() => {
        fetchResources();
    }, [fetchResources]); // Initial fetch

    const toggleResourceSelection = useCallback((id: string) => {
        setSelectedResourceIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
        setStepErrors({});
    }, []);

    const selectedResources = useMemo(() => {
        // Ensure resources array is up-to-date when calculating selectedResources
        return resources.filter(r => selectedResourceIds.has(r.id));
    }, [resources, selectedResourceIds]);


    // --- Preview Fetching Effect (keep as is) ---
    useEffect(() => {
        const fetchPreview = async (resource: Resource) => {
            if (previewContent[resource.id] || isLoadingPreview.has(resource.id)) return;

            setIsLoadingPreview(prev => new Set(prev).add(resource.id));
            let content: PreviewContent = { type: 'unsupported', data: null };
            const downloadUrl = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;

            try {
                if (resource.type.startsWith('text_') || resource.type.startsWith('json_')) {
                    const response = await fetch(downloadUrl);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const textData = await response.text();
                    content = {
                        type: resource.type.startsWith('json_') ? 'json' : 'text',
                        data: textData,
                    };
                } else if (resource.type === 'audio' || resource.type === 'snippet') {
                    content = { type: 'audio', data: downloadUrl };
                } else if (resource.type === 'video') {
                    content = { type: 'video_placeholder', data: null };
                }
            } catch (err: any) {
                console.error(`Error fetching preview for ${resource.original_name} (ID: ${resource.id}):`, err);
                content = { type: 'unsupported', data: null, error: `Failed to load preview: ${err.message}` };
            } finally {
                setPreviewContent(prev => ({ ...prev, [resource.id]: content }));
                setIsLoadingPreview(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(resource.id);
                    return newSet;
                });
            }
        };

        // Use the memoized selectedResources
        selectedResources.forEach(fetchPreview);

    }, [selectedResources, previewContent, isLoadingPreview]); // Dependencies


    // --- Upload Logic (keep as is) ---
    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setUploadError(null);
        setUploadProgress(0);
        if (acceptedFiles.length === 0) {
            setUploadProgress(null);
            return;
        };

        let filesProcessed = 0;
        const totalFiles = acceptedFiles.length;

        const getUploadResourceType = (filename: string): ResourceTypeString | null => {
            const ext = filename.split('.').pop()?.toLowerCase();
            if (!ext) return null;
            if (filename.toLowerCase().includes('prompt') && ext === 'txt') return 'text_prompt';
            // Allow uploading speaker maps directly
            if (filename.toLowerCase().includes('speaker_map') && ext === 'json') return 'json_speaker_map';
            if (ext === 'json') return 'json_transcript';
            if (ext === 'txt') return 'text_session'; // Default txt to session if not prompt
            if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
            if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
            return null;
        }

        const uploadPromises = acceptedFiles.map(async (file) => {
            const resourceType = getUploadResourceType(file.name);
            if (!resourceType) {
                console.warn(`Skipping upload for ${file.name}: Cannot determine resource type.`);
                setUploadError(prev => `${prev ? prev + '\n' : ''}Skipped ${file.name}: Unknown/unsupported type.`);
                filesProcessed++;
                setUploadProgress((filesProcessed / totalFiles) * 100);
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                await fetchApi(`/upload/${resourceType}`, { method: 'POST', body: formData });
            } catch (err: any) {
                console.error(`Failed to upload ${file.name}:`, err);
                setUploadError(prev => `${prev ? prev + '\n' : ''}Failed to upload ${file.name}: ${err.message}`);
            } finally {
                filesProcessed++;
                setUploadProgress((filesProcessed / totalFiles) * 100);
            }
        });

        await Promise.all(uploadPromises);
        await fetchResources(); // Wait for fetch to complete
        setTimeout(() => setUploadProgress(null), 1500);

    }, [fetchResources]);

    // --- Dropzone Hook (keep as is) ---
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        noClick: true,
        multiple: true,
        accept: ACCEPTED_FILE_TYPES.split(',').reduce((acc, ext) => {
            const mimeType = ext.trim(); // Basic mapping, adjust if needed
            acc[mimeType] = [];
            return acc;
        }, {} as Record<string, string[]>),
    });

    // --- Click/Select Handlers (keep as is, except for download/delete logic) ---
    const handleUploadClick = useCallback(() => { fileInputRef.current?.click(); }, []);
    const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) { onDrop(Array.from(event.target.files)); }
        event.target.value = '';
    }, [onDrop]);

    // Use the memoized selectedResources for handlers
    const handleDownloadSelected = useCallback(() => {
        if (selectedResources.length === 0) return;
        selectedResources.forEach(resource => {
            const link = document.createElement('a');
            link.href = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;
            link.download = resource.original_name || resource.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
        // Optional: Clear selection after download?
        // setSelectedResourceIds(new Set());
    }, [selectedResources]);

    const handleDeleteSelected = useCallback(() => {
        if (selectedResources.length === 0) return;
        setShowDeleteConfirmModal(true);
        setResourceToDelete(null);
    }, [selectedResources]);

    const confirmDeletion = useCallback(async () => {
        const resourcesToDeleteNow = resourceToDelete ? [resourceToDelete] : selectedResources; // Use state at time of click
        const idsToDelete = resourcesToDeleteNow.map(r => r.id);

        if (idsToDelete.length === 0) return;

        setError(null);
        let deleteErrors = "";

        const deletePromises = resourcesToDeleteNow.map(res =>
            fetchApi(`/resource/${res.type}/${res.id}`, { method: 'DELETE' })
                .catch(err => {
                    console.error(`Failed to delete ${res.original_name} (ID: ${res.id}):`, err);
                    deleteErrors += `Failed to delete ${res.original_name}: ${err.message}\n`;
                })
        );

        await Promise.all(deletePromises);

        if (deleteErrors) { setError(deleteErrors.trim()); }

        setShowDeleteConfirmModal(false);
        setResourceToDelete(null);
        setSelectedResourceIds(prev => { // Update selection based on what was *intended* for deletion
            const newSet = new Set(prev);
            idsToDelete.forEach(id => newSet.delete(id));
            return newSet;
        });
        await fetchResources(); // Refresh list from server *after* deletion attempts

    }, [resourceToDelete, selectedResources, fetchResources]); // Depend on selectedResources used in the callback scope

    const cancelDeletion = useCallback(() => {
        setShowDeleteConfirmModal(false);
        setResourceToDelete(null);
    }, []);

    const handleDeleteClick = useCallback((e: React.MouseEvent, resource: Resource) => {
        e.stopPropagation();
        setResourceToDelete(resource);
        setShowDeleteConfirmModal(true);
    }, []);


    // --- Pipeline Processing Logic ---
    const processJob = useCallback(async (job: ProcessingJob) => {
        setStepErrors(prev => ({ ...prev, [job.stepId]: null }));
        if (job.metaStepId) {
            setStepErrors(prev => ({ ...prev, [job.metaStepId || job.stepId]: null }));
        }
        setCurrentlyProcessing(job);

        const step = PIPELINE_STEPS.find(s => s.id === job.stepId);
        if (!step) {
            const errorMsg = `Internal error: Invalid step ID ${job.stepId}`;
            console.error(errorMsg);
            const errorKey = job.metaStepId || job.stepId;
            setStepErrors(prev => ({ ...prev, [errorKey]: errorMsg }));
            setCurrentlyProcessing(null);
            setProcessingQueue([]);
            return;
        }

        const formData = new FormData();
        const keyRequirements = step.requiresKeys || [];
        let missingKey = false;

        for (const keyName of keyRequirements) {
            const apiKey = keyName === 'assemblyAi' ? apiKeys.assemblyAi : apiKeys.googleGemini;
            if (!apiKey) {
                const errorMsg = `API Key "${keyName}" is required for step "${step.name}".`;
                const errorKey = job.metaStepId || job.stepId;
                setStepErrors(prev => ({ ...prev, [errorKey]: errorMsg }));
                setCurrentlyProcessing(null);
                setProcessingQueue([]);
                missingKey = true;
                break;
            }
            const backendKeyName = keyName === 'assemblyAi' ? 'assemblyai_api_key' : 'google_gemini_api_key';
            formData.append(backendKeyName, apiKey);
        }
        if (missingKey) return;

        // Fetch the latest resources *before* finding inputs
        const currentResources = await fetchResources(); // Fetch and update state, get latest list

        const inputResourcesForCurrentJob = currentResources.filter(r => job.inputResourceIds.includes(r.id));
        let missingInputForCurrentJob = false;
        step.inputs.forEach(inputType => {
            const resource = inputResourcesForCurrentJob.find(r => r.type === inputType);
            if (resource) {
                const fieldName = step.inputFieldNames?.[inputType] || `${inputType}_id`;
                formData.append(fieldName, resource.id);
            } else {
                const errorMsg = `Internal error: Missing required input of type '${inputType}' for step "${step.name}" (Job inputs: ${job.inputResourceIds.join(', ')}). Resources available: ${currentResources.map(r => r.id + ':' + r.type).join('; ')}`;
                console.error(errorMsg, "Input resources found for current job:", inputResourcesForCurrentJob);
                const errorKey = job.metaStepId || job.stepId;
                setStepErrors(prev => ({ ...prev, [errorKey]: errorMsg }));
                missingInputForCurrentJob = true;
            }
        });

        if (missingInputForCurrentJob) {
            setCurrentlyProcessing(null);
            setProcessingQueue([]);
            return;
        }

        let jobSuccessful = false;
        let resultResourceIds: string[] = [];
        let generatedResources: Resource[] = [];

        try {
            console.log(`Calling endpoint ${step.endpoint} for job step: ${job.stepId}`, job);
            console.log("FormData being sent:", Object.fromEntries(formData.entries()));

            const result = await fetchApi<Resource | { [key: string]: Resource } | null>(step.endpoint, {
                method: 'POST',
                body: formData,
            });

            console.log(`Step ${job.stepId} API call completed. Result:`, result);

            let fetchedAfterProcessing: Resource[] = [];
            if (result && typeof result === 'object') {
                if ('id' in result) {
                    resultResourceIds = [(result as Resource).id];
                    generatedResources = [result as Resource];
                } else {
                    generatedResources = Object.values(result);
                    resultResourceIds = generatedResources.map(r => r.id);
                }
                fetchedAfterProcessing = await fetchResources(resultResourceIds); // Fetch AND select new IDs
            } else {
                fetchedAfterProcessing = await fetchResources();
                console.log(`Step ${step.id} completed, but no specific resource was returned or result was null.`);
            }

            const currentResourcesAfterStep = fetchedAfterProcessing;

            // --- Sequence Handling Logic ---
            if (job.metaStepId && job.sequenceSteps && job.currentSequenceIndex !== undefined) {
                const currentJobIndex = job.currentSequenceIndex;
                const isTranscriptToSnippetsStep = job.stepId === 'transcript_to_snippets';

                // --- PAUSE LOGIC ---
                if (isTranscriptToSnippetsStep && generatedResources.length > 0) {
                    console.log(`Sequence: Pausing after ${job.stepId} for speaker mapping.`);
                    // Determine base name for resuming later
                    let baseNameToMatch: string | null = null;
                    if (generatedResources.length > 0) {
                        baseNameToMatch = getBaseNameForComparison(generatedResources[0].original_name);
                    } else if (job.originalInputResourceIds && job.originalInputResourceIds.length > 0) {
                        const originalResource = currentResourcesAfterStep.find(r => r.id === job.originalInputResourceIds![0]);
                        if (originalResource) baseNameToMatch = getBaseNameForComparison(originalResource.original_name);
                    }

                    // Store pause state
                    setPausedSequenceData({
                        metaStepId: job.metaStepId,
                        sequenceSteps: job.sequenceSteps,
                        pausedAtIndex: currentJobIndex, // Store index of the step that just finished
                        originalInputResourceIds: job.originalInputResourceIds || [],
                        baseNameToMatch: baseNameToMatch,
                        generatedResourceIdsBeforePause: resultResourceIds // Store IDs generated by this step
                    });

                    // Show the modal
                    const generatedSnippets = generatedResources as Resource[];
                    setSnippetsForMapping(generatedSnippets);
                    setShowSpeakerMapForm(true);

                    // DO NOT proceed to queue the next job here

                }
                // --- STANDARD CONTINUATION LOGIC ---
                else {
                    const nextSequenceIndex = currentJobIndex + 1;
                    if (nextSequenceIndex < job.sequenceSteps.length) {
                        const nextStepId = job.sequenceSteps[nextSequenceIndex];
                        const nextStepDef = PIPELINE_STEPS.find(s => s.id === nextStepId);
                        const completedStepOutput = step.output;

                        if (nextStepDef) {
                            console.log(`Sequence: Preparing next step ${nextStepId} (needs inputs: ${nextStepDef.inputs.join(', ')})`);
                            let nextInputResourcesFound: Resource[] = [];
                            let nextInputIds: string[] = [];
                            let inputsMissingForNext = false;
                            let baseNameToMatch: string | null = null; // Determine base name again for this context

                            if (generatedResources.length > 0) {
                                baseNameToMatch = getBaseNameForComparison(generatedResources[0].original_name);
                            } else if (job.originalInputResourceIds && job.originalInputResourceIds.length > 0) {
                                const originalResource = currentResourcesAfterStep.find(r => r.id === job.originalInputResourceIds![0]);
                                if (originalResource) baseNameToMatch = getBaseNameForComparison(originalResource.original_name);
                            }
                            console.log(`Sequence: Base name to match for finding inputs for ${nextStepId}:`, baseNameToMatch);

                            // Find inputs (using the refined logic from previous step)
                            for (const nextInputType of nextStepDef.inputs) {
                                let foundInputForType: Resource | null = null;

                                // 1. Check direct output
                                if (nextInputType === completedStepOutput) {
                                    const matchingGenerated = generatedResources.find(r => r.type === nextInputType);
                                    if (matchingGenerated) foundInputForType = matchingGenerated;
                                    console.log(`Sequence: Input ${nextInputType} ${foundInputForType ? `found from direct output: ${foundInputForType.id}` : 'not found in direct output'}`);
                                }

                                // 2. If the required type is text_prompt, search regardless of base name.
                                if (!foundInputForType && nextInputType === 'text_prompt') {
                                    const potentialMatches = currentResourcesAfterStep.filter(r => r.type === nextInputType);
                                    if (potentialMatches.length === 1) {
                                        foundInputForType = potentialMatches[0];
                                        console.log(`Sequence: Input ${nextInputType} found by direct selection: ${foundInputForType.id}`);
                                    } else if (potentialMatches.length > 1) {
                                        potentialMatches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                                        foundInputForType = potentialMatches[0];
                                        console.warn(`Sequence: Ambiguous match for ${nextInputType}. Using newest: ${foundInputForType.id}`);
                                    } else {
                                        console.log(`Sequence: Input ${nextInputType} not found in current resources.`);
                                    }
                                }

                                // 3. Check by base name (for other input types)
                                if (!foundInputForType && baseNameToMatch) {
                                    const potentialMatches = currentResourcesAfterStep.filter(r =>
                                        r.type === nextInputType &&
                                        getBaseNameForComparison(r.original_name) === baseNameToMatch
                                    );
                                    if (potentialMatches.length === 1) {
                                        foundInputForType = potentialMatches[0];
                                        console.log(`Sequence: Input ${nextInputType} found by base name match: ${foundInputForType.id}`);
                                    } else if (potentialMatches.length > 1) {
                                        potentialMatches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                                        foundInputForType = potentialMatches[0];
                                        console.warn(`Sequence: Ambiguous base name match for ${nextInputType} (base: ${baseNameToMatch}). Using newest: ${foundInputForType.id}`);
                                    } else {
                                        console.log(`Sequence: Input ${nextInputType} not found by base name match.`);
                                    }
                                }

                                if (foundInputForType) {
                                    if (!nextInputIds.includes(foundInputForType.id)) {
                                        nextInputResourcesFound.push(foundInputForType);
                                        nextInputIds.push(foundInputForType.id);
                                    }
                                } else {
                                    console.error(`Sequence Error: Could not find required input '${nextInputType}' for step '${nextStepId}' (Base name: ${baseNameToMatch}).`);
                                    const errorKey = job.metaStepId || job.stepId;
                                    setStepErrors(prev => ({ ...prev, [errorKey]: `Sequence failed: Could not find input '${nextInputType}' for step '${nextStepDef.name}'.` }));
                                    inputsMissingForNext = true;
                                    break;
                                }
                            } // End input finding loop

                            if (!inputsMissingForNext) {
                                const nextJob: ProcessingJob = {
                                    stepId: nextStepId,
                                    inputResourceIds: [...new Set(nextInputIds)],
                                    inputOriginalNames: Object.fromEntries(nextInputResourcesFound.map(r => [r.id, r.original_name || r.filename])),
                                    apiKeys: nextStepDef.requiresKeys ? apiKeys : undefined,
                                    metaStepId: job.metaStepId,
                                    sequenceSteps: job.sequenceSteps,
                                    currentSequenceIndex: nextSequenceIndex,
                                    originalInputResourceIds: job.originalInputResourceIds,
                                };
                                console.log("Sequence: Queueing next job", nextJob);
                                setProcessingQueue(prev => [...prev, nextJob]);
                            } else {
                                setProcessingQueue([]); // Clear queue if error
                            }

                        } else { // nextStepDef not found
                            console.error(`Sequence Error: Next step ID '${nextStepId}' not found in PIPELINE_STEPS.`);
                            const errorKey = job.metaStepId || job.stepId;
                            setStepErrors(prev => ({ ...prev, [errorKey]: `Sequence failed: Invalid next step ID '${nextStepId}'.` }));
                            setProcessingQueue([]);
                        }
                    } else { // Last step in sequence completed
                        console.log(`Sequence for ${job.metaStepId} completed successfully at step ${job.stepId}.`);
                        // Optional: Select the final output resources?
                        // setSelectedResourceIds(new Set(resultResourceIds));
                    }
                } // End sequence handling block


                // --- Handle Speaker Mapping Modal ---
                if (step.id === 'transcript_to_snippets' && generatedResources.length > 0 && generatedResources[0].type === 'snippet') {
                    const generatedSnippets = generatedResources as Resource[];
                    setSnippetsForMapping(generatedSnippets);
                    setShowSpeakerMapForm(true);
                }

                jobSuccessful = true;
            }
        }
        catch (err: any) {
            console.error(`Error processing job ${job.stepId} (part of ${job.metaStepId || 'standalone'}):`, err);
            const errorKey = job.metaStepId || job.stepId;
            setStepErrors(prev => ({ ...prev, [errorKey]: `Step "${step.name}" failed: ${err.message}` }));
            setProcessingQueue([]);
        }
        finally {
            setCurrentlyProcessing(null);
        }

    }, [apiKeys, fetchResources, getBaseNameForComparison]);


    // --- Queue Runner Effect (keep as is) ---
    useEffect(() => {
        if (!currentlyProcessing && processingQueue.length > 0) {
            const nextJob = processingQueue[0];
            setProcessingQueue(prev => prev.slice(1));
            processJob(nextJob); // Process the job
        }
    }, [currentlyProcessing, processingQueue, processJob]); // processJob is now a dependency

    // --- Start/Stop Processing Handlers ---
    const handleStartProcessing = useCallback((step: PipelineStep) => {
        setError(null); // Clear global errors
        setStepErrors(prev => ({ ...prev, [step.id]: null })); // Clear previous errors specifically for this step
        console.log(`Attempting to start step: ${step.id}`);
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id)); // Get currently selected resources

        // Check if any resources are selected at all
        if (currentSelectedResources.length === 0) {
            setStepErrors(prev => ({ ...prev, [step.id]: "No resources selected." }));
            console.log(`Step ${step.id} start prevented: No resources selected.`);
            return; // Stop processing if nothing is selected
        }

        const newJobs: ProcessingJob[] = []; // Initialize array to hold jobs to be queued

        // --- Handle Meta-Step ---
        if (step.sequence && step.sequence.length > 0) {
            console.log(`Handling meta-step sequence: ${step.id}`);
            const firstStepId = step.sequence[0];
            const firstStepDef = PIPELINE_STEPS.find(s => s.id === firstStepId);

            if (!firstStepDef) {
                const errorMsg = `Internal Error: First step '${firstStepId}' of sequence '${step.name}' not found.`;
                console.error(errorMsg);
                setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
                return; // Stop if sequence definition is broken
            }

            // Find selected resources that match the *initial* input type required by the meta-step
            const initialInputType = step.inputs[0];
            const selectedInitialInputs = currentSelectedResources.filter(r => r.type === initialInputType);

            if (selectedInitialInputs.length === 0) {
                const errorMsg = `Invalid selection for sequence "${step.name}". Select required initial input(s): ${step.inputs.join(', ')}.`;
                setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
                console.log(`Meta-step ${step.id} start prevented: No matching initial inputs selected.`);
                return; // Stop if no initial inputs are selected
            }

            // Create one sequence job chain for each selected initial input resource
            selectedInitialInputs.forEach(initialResource => {
                newJobs.push({
                    // Job targets the *first actual step* in the sequence
                    stepId: firstStepId,
                    inputResourceIds: [initialResource.id],
                    inputOriginalNames: { [initialResource.id]: initialResource.original_name || initialResource.filename },
                    apiKeys: firstStepDef.requiresKeys ? apiKeys : undefined,
                    // --- Sequence Info ---
                    metaStepId: step.id, // Link back to the parent meta-step
                    sequenceSteps: step.sequence, // Store the full sequence
                    currentSequenceIndex: 0, // Start at the first step (index 0)
                    originalInputResourceIds: [initialResource.id] // Track the very first input resource ID
                });
            });
            console.log(`Created ${newJobs.length} sequence job chain(s) for meta-step ${step.id}, starting with step ${firstStepId}`);

        }
        // --- Handle Regular Multi-Input Step (Revised Logic for Subsets) ---
        else if (step.multiInput && step.inputs.length > 0) {
            console.log(`Handling multi-input step: ${step.id}. Needs input types: ${step.inputs.join(', ')}`);

            // 1. Collect candidate resources for each required input type from the overall selection
            const candidatesByType: { [type in ResourceTypeString]?: Resource[] } = {};
            step.inputs.forEach(inputType => {
                candidatesByType[inputType] = currentSelectedResources.filter(r => r.type === inputType);
                console.log(` - Found ${candidatesByType[inputType]?.length ?? 0} selected candidate(s) for type '${inputType}'`);
            });

            // 2. Check if we have at least one candidate for *every* required type
            const hasCandidatesForAllTypes = step.inputs.every(inputType => (candidatesByType[inputType]?.length ?? 0) > 0);

            if (hasCandidatesForAllTypes) {
                // 3. Attempt to form valid groups based on matching base names
                const anchorInputType = step.inputs[0]; // Use the first required type as the anchor for matching
                const anchorCandidates = candidatesByType[anchorInputType]!;
                const usedResourceIds = new Set<string>(); // Track resources already assigned to a job in this batch

                console.log(`Attempting to match groups based on base names, using type '${anchorInputType}' as anchor.`);
                anchorCandidates.forEach(anchorResource => {
                    // Skip if this anchor resource was already part of a successful group found earlier
                    if (usedResourceIds.has(anchorResource.id)) return;

                    const baseName = getBaseNameForComparison(anchorResource.original_name);
                    // It's possible for a file to have no discernible base name if improperly named
                    if (!baseName) {
                        console.warn(`Skipping anchor resource ${anchorResource.original_name} (${anchorResource.id}) as it yields no comparable base name.`);
                        return; // Cannot match this resource without a base name
                    }

                    const potentialGroup: { [type in ResourceTypeString]?: Resource } = { [anchorInputType]: anchorResource };
                    let groupComplete = true; // Assume complete until a partner is missing

                    // Iterate through the *other* required input types to find matching partners
                    for (let i = 1; i < step.inputs.length; i++) {
                        const requiredType = step.inputs[i];
                        const partnerCandidates = candidatesByType[requiredType]!;

                        // Find a partner candidate that:
                        // 1. Matches the required type
                        // 2. Has the *same* base name as the anchor resource
                        // 3. Has *not* already been used in another group in this batch
                        const partner = partnerCandidates.find(candidate =>
                            !usedResourceIds.has(candidate.id) &&
                            getBaseNameForComparison(candidate.original_name) === baseName
                        );

                        if (partner) {
                            potentialGroup[requiredType] = partner; // Add the found partner to the potential group
                        } else {
                            groupComplete = false; // Could not find a matching, unused partner for this required type
                            console.log(` - For anchor ${anchorResource.original_name} (base: '${baseName}'), could not find unused partner of type '${requiredType}'`);
                            break; // Stop trying to complete this group for this anchor
                        }
                    }

                    // If we successfully found matching partners for all other required types
                    if (groupComplete) {
                        const groupResources = Object.values(potentialGroup) as Resource[];
                        const groupResourceIds = groupResources.map(r => r.id);

                        console.log(`   + Found valid group based on base name '${baseName}': IDs [${groupResourceIds.join(', ')}]`);
                        newJobs.push({
                            stepId: step.id,
                            inputResourceIds: groupResourceIds,
                            apiKeys: step.requiresKeys ? apiKeys : undefined,
                            inputOriginalNames: Object.fromEntries(groupResources.map(r => [r.id, r.original_name || r.filename]))
                            // No sequence info for regular steps
                        });

                        // Mark all resources in this successful group as used for this run
                        groupResourceIds.forEach(id => usedResourceIds.add(id));
                    }
                }); // End looping through anchor candidates

                // Fallback: If NO jobs were created via base name matching,
                // AND if exactly one candidate exists for each required type *within the selection*,
                // create a job with that single set. This handles the simple case where names might not match.
                if (newJobs.length === 0 && step.inputs.every(inputType => candidatesByType[inputType]?.length === 1)) {
                    console.log(`Base name matching yielded no jobs for step ${step.id}. Applying fallback: using the single available candidate for each required type.`);
                    const singleGroupResources = step.inputs.map(inputType => candidatesByType[inputType]![0]);
                    const singleGroupResourceIds = singleGroupResources.map(r => r.id);

                    // Optional: Check for filename mismatch warning here if desired for the fallback case
                    // const mismatchWarning = getFilenameMismatchWarning(step, singleGroupResources); // Needs adjustment to getFilenameMismatchWarning
                    // if (mismatchWarning) { console.warn(mismatchWarning); }

                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: singleGroupResourceIds,
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: Object.fromEntries(singleGroupResources.map(r => [r.id, r.original_name || r.filename]))
                    });
                    console.log(`   + Created fallback job with IDs [${singleGroupResourceIds.join(', ')}]`);
                } else if (newJobs.length === 0) {
                    console.log(`Could not form any valid groups for multi-input step ${step.id} based on base name matching or single set fallback.`);
                }

            } else {
                // This case means that even though the step might be eligible (some resources of each type exist),
                // the current selection doesn't contain at least one of each required type.
                // This might occur if eligibility logic slightly differs or state updates were weird.
                // The final error message outside this block will handle informing the user.
                console.log(`Cannot proceed with multi-input step ${step.id}: The current selection is missing candidates for one or more required types (${step.inputs.join(', ')}).`);
            }
        }
        // --- Handle Regular Single-Input Step ---
        else if (step.inputs.length === 1) {
            const inputType = step.inputs[0];
            console.log(`Handling single-input step: ${step.id}. Needs input type: ${inputType}`);
            // Find all selected resources that match the single required input type
            const matchingResources = currentSelectedResources.filter(r => r.type === inputType);

            if (matchingResources.length > 0) {
                matchingResources.forEach(resource => {
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: [resource.id],
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: { [resource.id]: resource.original_name || resource.filename }
                        // No sequence info for regular steps
                    });
                });
                console.log(`Created ${newJobs.length} job(s) for single-input step ${step.id}.`);
            } else {
                console.log(`No selected resources match the required input type '${inputType}' for step ${step.id}.`);
            }
        }

        // --- Final Check and Queueing ---
        if (newJobs.length > 0) {
            // If any jobs were successfully created (for meta, multi, or single input steps)
            console.log(`Queueing ${newJobs.length} job(s) for step ${step.id}`);
            setProcessingQueue(prev => [...prev, ...newJobs]);
        } else {
            // If after all checks (meta, multi, single), NO jobs could be created
            const errorMsg = `Could not find valid inputs for step "${step.name}" in the current selection. Required input type(s): ${step.inputs.join(', ')}. Please check selection, resource availability, and naming conventions (for multi-input steps).`;
            setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
            console.log(`No valid jobs could be created for step ${step.id} from the current selection.`);
        }
    }, [selectedResourceIds, apiKeys, resources, getBaseNameForComparison]); // Dependencies

    const handleStopProcessing = useCallback(() => {
        setProcessingQueue([]); // Clear the queue
        // Note: The currently running job (if any) cannot be easily interrupted from the frontend.
        // It will finish, but no subsequent jobs will be started.
        if (currentlyProcessing) {
            console.log("Processing queue cleared. Current job will finish.");
            // Optional: Reset currentlyProcessing state visually immediately?
            // setCurrentlyProcessing(null); // This might cause UI flicker if the job finishes right after.
        }
    }, [currentlyProcessing]);

    // --- Speaker Map Logic (mostly unchanged, but ensure fetchResources updates state) ---
    const handleSpeakerNameChange = useCallback((label: string, name: string) => {
        setSpeakerMapInput(prev => ({ ...prev, [label]: name }));
    }, []);

    const submitSpeakerMap = useCallback(async () => {
        const filledEntries = Object.entries(speakerMapInput).filter(([_, name]) => name.trim() !== '');
        if (filledEntries.length === 0) {
            setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': "Please enter names for the speakers." }));
            return;
        }
        // Use the specific step ID where the error should appear
        setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': null }));
        let uploadedMapResource: Resource | null = null;
        let latestResourcesAfterUpload: Resource[] = [];

        try {
            // Use only the filled entries for the map
            const mapToSave = Object.fromEntries(filledEntries);
            const mapJsonString = JSON.stringify(mapToSave, null, 2);
            const blob = new Blob([mapJsonString], { type: 'application/json' });
            let baseName = "session";
            if (snippetsForMapping.length > 0) {
                const derivedBaseName = getBaseNameForComparison(snippetsForMapping[0].original_name);
                if (derivedBaseName && derivedBaseName !== Path.stem(snippetsForMapping[0].original_name)) {
                    baseName = derivedBaseName;
                }
            } else if (pausedSequenceData?.baseNameToMatch) {
                // Fallback to paused data if snippets aren't available for some reason
                baseName = pausedSequenceData.baseNameToMatch;
            }
            const filename = `${baseName}_speaker_map.json`;

            const formData = new FormData();
            formData.append('file', blob, filename);

            console.log(`Uploading speaker map as ${filename}...`);
            uploadedMapResource = await fetchApi<Resource>('/upload/json_speaker_map', {
                method: 'POST',
                body: formData,
            });

            if (uploadedMapResource) {
                // Fetch resources AND select the newly uploaded map
                latestResourcesAfterUpload = await fetchResources([uploadedMapResource.id]);
            } else { throw new Error("Speaker map upload did not return resource details."); }

        } catch (err: any) {
            console.error("Failed to submit speaker map:", err);
            setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': `Failed to save speaker map: ${err.message}` }));
            // Don't proceed to resume sequence if upload failed
            return;
        }

        // --- Sequence Resumption Logic ---
        if (pausedSequenceData && uploadedMapResource) {
            console.log("Sequence: Resuming sequence after speaker map submission.");
            const pausedData = pausedSequenceData;
            setPausedSequenceData(null); // Clear pause state

            const nextSequenceIndex = pausedData.pausedAtIndex + 1;
            if (nextSequenceIndex < pausedData.sequenceSteps.length) {
                const nextStepId = pausedData.sequenceSteps[nextSequenceIndex];
                const nextStepDef = PIPELINE_STEPS.find(s => s.id === nextStepId);

                if (nextStepDef) {
                    let resumeInputResourcesFound: Resource[] = [];
                    let resumeInputIds: string[] = [];
                    let inputsMissingForResume = false;

                    console.log(`Sequence: Preparing resuming step ${nextStepId} (needs inputs: ${nextStepDef.inputs.join(', ')})`);

                    // Find inputs needed for the resuming step (e.g., transcript_to_session)
                    for (const resumeInputType of nextStepDef.inputs) {
                        let foundInputForResume: Resource | null = null;

                        // 1. Is it the speaker map we just uploaded?
                        if (resumeInputType === 'json_speaker_map') {
                            foundInputForResume = uploadedMapResource;
                            console.log(`Sequence Resume: Input ${resumeInputType} found from uploaded map: ${foundInputForResume.id}`);
                        }
                        // 2. Is it the transcript (or other file) matching the base name?
                        else if (pausedData.baseNameToMatch) {
                            const potentialMatches = latestResourcesAfterUpload.filter(r =>
                                r.type === resumeInputType &&
                                getBaseNameForComparison(r.original_name) === pausedData.baseNameToMatch
                            );
                            if (potentialMatches.length === 1) {
                                foundInputForResume = potentialMatches[0];
                                console.log(`Sequence Resume: Input ${resumeInputType} found by base name match: ${foundInputForResume.id}`);
                            } else if (potentialMatches.length > 1) {
                                potentialMatches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                                foundInputForResume = potentialMatches[0];
                                console.warn(`Sequence Resume: Ambiguous base name match for ${resumeInputType}. Using newest: ${foundInputForResume.id}`);
                            }
                            // else not found by base name
                        }

                        if (foundInputForResume) {
                            if (!resumeInputIds.includes(foundInputForResume.id)) {
                                resumeInputResourcesFound.push(foundInputForResume);
                                resumeInputIds.push(foundInputForResume.id);
                            }
                        } else {
                            console.error(`Sequence Resume Error: Could not find required input '${resumeInputType}' for step '${nextStepId}'.`);
                            // Associate error with the *meta step* ID stored in pausedData
                            setStepErrors(prev => ({ ...prev, [pausedData.metaStepId]: `Sequence failed: Could not find input '${resumeInputType}' for step '${nextStepDef.name}' after speaker mapping.` }));
                            inputsMissingForResume = true;
                            break;
                        }
                    } // End input finding loop for resume

                    if (!inputsMissingForResume) {
                        const resumeJob: ProcessingJob = {
                            stepId: nextStepId,
                            inputResourceIds: [...new Set(resumeInputIds)],
                            inputOriginalNames: Object.fromEntries(resumeInputResourcesFound.map(r => [r.id, r.original_name || r.filename])),
                            apiKeys: nextStepDef.requiresKeys ? apiKeys : undefined,
                            // Carry over sequence info from pausedData
                            metaStepId: pausedData.metaStepId,
                            sequenceSteps: pausedData.sequenceSteps,
                            currentSequenceIndex: nextSequenceIndex, // Start from the step *after* the pause
                            originalInputResourceIds: pausedData.originalInputResourceIds,
                        };
                        console.log("Sequence: Queueing resumed job", resumeJob);
                        setProcessingQueue(prev => [...prev, resumeJob]);

                        // Clear the form state ONLY if resume was successful
                        setShowSpeakerMapForm(false);
                        setSnippetsForMapping([]);
                        setSpeakerMapInput({});

                    } // End if !inputsMissingForResume

                } else { // nextStepDef not found
                    console.error(`Sequence Resume Error: Next step ID '${nextStepId}' not found.`);
                    setStepErrors(prev => ({ ...prev, [pausedData.metaStepId]: `Sequence failed: Invalid next step ID '${nextStepId}'.` }));
                }
            } else { // Should not happen if sequence was defined correctly
                console.log("Sequence: Speaker map submitted, but sequence was already completed according to paused index.");
                // Clear form state even if sequence doesn't resume? Yes.
                setShowSpeakerMapForm(false);
                setSnippetsForMapping([]);
                setSpeakerMapInput({});
            }
        } else {
            // Speaker map submitted, but no sequence was paused. Just clear the form.
            setShowSpeakerMapForm(false);
            setSnippetsForMapping([]);
            setSpeakerMapInput({});
            console.log("Speaker map saved (no sequence resumed).");
        }

    }, [speakerMapInput, snippetsForMapping, fetchResources, getBaseNameForComparison, pausedSequenceData, apiKeys]); // Added dependencies

    // --- Eligibility & Validation Logic (check sequence steps too) ---
    const checkStepEligibility = useCallback((step: PipelineStep): boolean => {
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
        if (currentSelectedResources.length === 0) return false;

        // Use the step's defined inputs (for meta-steps, this is the *initial* input)
        const requiredInputs = step.inputs;

        if (step.multiInput || step.sequence) { // Meta-steps are treated like multi-input for eligibility check based on *initial* input
            // Check if *at least one* resource of *each* required input type is selected
            return requiredInputs.every(inputType =>
                currentSelectedResources.some(r => r.type === inputType)
            );
        } else if (requiredInputs.length === 1) {
            // Check if *at least one* resource of the single required type is selected
            return currentSelectedResources.some(r => r.type === requiredInputs[0]);
        }
        return false; // Should not happen with valid step definitions
    }, [resources, selectedResourceIds]); // Dependencies

    // Filename mismatch warning needs context, maybe less relevant for sequences? Keep as is for now.
    const getFilenameMismatchWarning = useCallback((step: PipelineStep): string | null => {
        // Only apply to specific multi-input steps that benefit from matching names
        if (!step.multiInput || step.id !== 'transcript_to_snippets') { // Example: only for this specific step
            return null;
        }
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
        const selectedAudios = currentSelectedResources.filter(r => r.type === 'audio');
        const selectedTranscripts = currentSelectedResources.filter(r => r.type === 'json_transcript');

        // Only warn if exactly one of each is selected (heuristic might fail otherwise)
        if (selectedAudios.length === 1 && selectedTranscripts.length === 1) {
            const audioBase = getBaseNameForComparison(selectedAudios[0].original_name);
            const transcriptBase = getBaseNameForComparison(selectedTranscripts[0].original_name);

            if (audioBase && transcriptBase && audioBase !== transcriptBase) {
                return `Warning: Selected audio (${selectedAudios[0].original_name}) and transcript (${selectedTranscripts[0].original_name}) base names do not match.`;
            }
        }
        return null;
    }, [resources, selectedResourceIds, getBaseNameForComparison]); // Dependencies


    // --- API Key Change Handler (keep as is) ---
    const handleApiKeyChange = useCallback((keyName: 'assemblyAi' | 'googleGemini', value: string) => {
        setApiKeys(prev => ({ ...prev, [keyName]: value }));
    }, []);

    // --- Render Preview Function (keep as is) ---
    const renderPreview = useCallback((resource: Resource) => {
        // ... (previous implementation is fine) ...
        const content = previewContent[resource.id];
        const isLoading = isLoadingPreview.has(resource.id);

        return (
            <div key={resource.id} className="mb-4 p-3 border dark:border-gray-700 rounded bg-white dark:bg-gray-800 shadow-sm">
                <h4 className="font-semibold text-sm mb-1 truncate text-gray-800 dark:text-gray-100" title={resource.original_name}>
                    {resource.original_name}
                </h4>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center space-x-2">
                    <span>Type: {resource.type}</span>
                    <span className='flex items-center' title="Internal Resource ID">
                        <span className='mr-0.5'><FiInfo size={10} /></span> ID: <code className='ml-1 text-xxs'>{resource.id.substring(0, 8)}...</code>
                    </span>
                </div>
                {isLoading && <div className="text-center p-4 text-gray-500 dark:text-gray-400"><span className="animate-spin inline-block mr-2"><FiLoader /></span>Loading Preview...</div>}
                {!isLoading && content && (
                    <>
                        {content.type === 'text' && <pre className="text-xs whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded max-h-60 overflow-y-auto">{content.data}</pre>}
                        {content.type === 'json' && <pre className="text-xs whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded max-h-60 overflow-y-auto">{tryFormatJson(content.data)}</pre>}
                        {content.type === 'audio' && content.data && <audio controls src={content.data} className="w-full h-10"></audio>}
                        {content.type === 'video_placeholder' && <div className="text-center p-4 text-gray-400 dark:text-gray-500 text-sm">Video Preview Not Available</div>}
                        {content.type === 'unsupported' && <div className="text-center p-4 text-red-600 dark:text-red-400 text-sm">{content.error || 'Preview not available'}</div>}
                    </>
                )}
                {!isLoading && !content && <div className="text-center p-4 text-gray-400 dark:text-gray-500 text-sm">Select resource(s) to load preview.</div>}
            </div>
        );
    }, [previewContent, isLoadingPreview, tryFormatJson]);


    // --- Main JSX Structure ---
    return (
        <div className="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">

            {/* --- Resources Panel (Left) --- */}
            <ResourcesPanel
                resources={resources}
                selectedResourceIds={selectedResourceIds}
                isLoadingResources={isLoadingResources}
                isDragActive={isDragActive}
                uploadProgress={uploadProgress}
                uploadError={uploadError}
                onUploadClick={handleUploadClick}
                onDownloadSelected={handleDownloadSelected}
                onDeleteSelected={handleDeleteSelected}
                onToggleResourceSelection={toggleResourceSelection}
                onDeleteClick={handleDeleteClick}
                getRootProps={getRootProps}
                getInputProps={getInputProps}
                fileInputRef={fileInputRef}
                onFileSelected={handleFileSelected}
                acceptFileTypes={ACCEPTED_FILE_TYPES}
            />

            {/* --- Preview Panel (Middle) --- */}
            <PreviewPanel
                selectedResources={selectedResources} // Pass the memoized value
                renderPreview={renderPreview}
            />

            {/* --- Pipeline Panel (Right) --- */}
            <PipelinePanel
                error={error} // Global errors
                apiKeys={apiKeys}
                onApiKeyChange={handleApiKeyChange}
                currentlyProcessing={currentlyProcessing} // Pass the whole job object
                processingQueue={processingQueue}
                onStopProcessing={handleStopProcessing}
                pipelineSteps={PIPELINE_STEPS} // Pass all steps including meta
                stepErrors={stepErrors} // Pass step-specific errors
                onStartProcessing={handleStartProcessing} // Pass the handler
                checkStepEligibility={checkStepEligibility} // Pass eligibility checker
                getFilenameMismatchWarning={getFilenameMismatchWarning} // Pass warning checker
            />

            {/* --- Modals (Keep in App.tsx) --- */}
            {showSpeakerMapForm && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-40">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Identify Speakers</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Listen to snippets and enter speaker names. The speaker map will be saved as a new resource.</p>
                        {/* Show error associated with the snippet step */}
                        {stepErrors['transcript_to_snippets'] && (
                            <p className="text-xs text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/50 p-1.5 rounded mb-3 inline-flex items-center border border-red-300 dark:border-red-700">
                                <span className="mr-1 flex-shrink-0"><FiAlertTriangle /></span> {stepErrors['transcript_to_snippets']}
                            </p>
                        )}
                        <div className="space-y-3">
                            {snippetsForMapping.map(snippet => {
                                const match = snippet.original_name.match(/_speaker_([A-Z])_/i);
                                // Default to a generic label if pattern doesn't match, though it should
                                const label = match ? match[1].toUpperCase() : `SPEAKER_${snippet.id.substring(0, 4)}`;
                                return (
                                    <div key={snippet.id} className="flex items-center space-x-3 border-b dark:border-gray-700 pb-3 last:border-b-0">
                                        <label htmlFor={`speaker-input-${label}`} className="font-mono font-bold w-12 text-center text-gray-700 dark:text-gray-300 flex-shrink-0">{`Speaker ${label}:`}</label>
                                        <input
                                            type="text"
                                            id={`speaker-input-${label}`}
                                            placeholder="Enter Speaker Name"
                                            value={speakerMapInput[label] || ''}
                                            onChange={(e) => handleSpeakerNameChange(label, e.target.value)}
                                            className="flex-grow p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        />
                                        {/* Provide download URL directly to audio element */}
                                        <audio controls src={`${API_BASE_URL}/download/snippet/${snippet.id}`} className="h-8 w-40 flex-shrink-0"></audio>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-6 flex justify-end space-x-3">
                            <button onClick={() => { setShowSpeakerMapForm(false); setSnippetsForMapping([]); setSpeakerMapInput({}); setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': null })); }} className="bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-black dark:text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" > Cancel </button>
                            <button onClick={submitSpeakerMap} className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" > Save Speaker Map </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteConfirmModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md">
                        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Confirm Deletion</h2>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
                            {resourceToDelete
                                ? <>Are you sure you want to permanently delete <strong className='font-medium break-all'>"{resourceToDelete.original_name}"</strong>?</>
                                // Use selectedResources length directly for accuracy at confirmation time
                                : <>Are you sure you want to permanently delete the <strong className='font-medium'>{selectedResources.length}</strong> selected resource(s)?</>
                            }
                            <br />This action cannot be undone.
                        </p>
                        <div className="flex justify-end space-x-3">
                            <button onClick={cancelDeletion} className="bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-black dark:text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" > Cancel </button>
                            <button onClick={confirmDeletion} className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" > Delete </button>
                        </div>
                    </div>
                </div>
            )}

        </div> // End Main Flex Container
    );
}

export default App;
