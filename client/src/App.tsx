// client/src/App.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { FiAlertTriangle, FiLoader, FiInfo, FiFastForward } from 'react-icons/fi'; // Added FiFastForward

// Import the new components
import { ResourcesPanel } from './components/ResourcesPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { PipelinePanel } from './components/PipelinePanel';

// Import types (assuming they are in src/types.ts)
import { Resource, ResourceTypeString, PipelineStep, PreviewContent, ProcessingJob } from './types'; // Ensure path is correct

// --- Constants ---
const API_BASE_URL = 'http://127.0.0.1:8000';
const ACCEPTED_FILE_TYPES = ".mp4,.mov,.avi,.mkv,.webm,.mp3,.wav,.ogg,.m4a,.flac,.json,.txt";

// --- Pipeline Definition ---
// *** ADD THE NEW META-STEP AT THE TOP ***
const PIPELINE_STEPS: PipelineStep[] = [
    {
        id: 'meta_video_to_snippets', // Unique ID for the meta-step
        name: '▶️ Video to Snippets', // Use an icon or prefix to denote meta
        inputs: ['video'],           // The initial input type required
        output: 'snippet',           // The final output type expected
        endpoint: '',                // No direct endpoint
        sequence: [                  // The sequence of actual step IDs
            'video_to_audio',
            'audio_to_transcript',
            'transcript_to_snippets'
        ],
        // Note: requirements like keys are handled by the individual steps in the sequence
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

// --- Utility Functions (keep as is) ---
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
        .replace('_snippet', '') // Add snippet removal
        .replace(/_speaker_[A-Z]/i, '') // Add specific speaker snippet removal
        .replace('_speaker_map', '')
        .replace(/\.\w+$/, '');
};
namespace Path { export function stem(filename: string): string { const parts = filename.split('.'); parts.pop(); return parts.join('.'); } }
const tryFormatJson = (jsonString: string | null): string => {
    if (!jsonString) return '';
    try {
        return JSON.stringify(JSON.parse(jsonString), null, 2);
    } catch {
        return jsonString;
    }
};


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

            // --- Handle Sequence Continuation ---
            if (job.metaStepId && job.sequenceSteps && job.currentSequenceIndex !== undefined) {
                const nextSequenceIndex = job.currentSequenceIndex + 1;
                if (nextSequenceIndex < job.sequenceSteps.length) {
                    const nextStepId = job.sequenceSteps[nextSequenceIndex];
                    const nextStepDef = PIPELINE_STEPS.find(s => s.id === nextStepId);
                    const completedStepOutput = step.output; // Type of resource just created

                    if (nextStepDef) {
                        console.log(`Sequence: Preparing next step ${nextStepId} (needs inputs: ${nextStepDef.inputs.join(', ')})`);
                        let nextInputResourcesFound: Resource[] = [];
                        let nextInputIds: string[] = [];
                        let inputsMissingForNext = false;
                        let baseNameToMatch: string | null = null;

                        // --- Determine the base name for this sequence instance ---
                        // Prioritize using the generated resource from the *completed* step
                        if (generatedResources.length > 0) {
                            baseNameToMatch = getBaseNameForComparison(generatedResources[0].original_name);
                        } else if (job.originalInputResourceIds && job.originalInputResourceIds.length > 0) {
                            // Fallback: try getting base name from the *original* input if the completed step produced no direct resource
                            const originalResource = currentResourcesAfterStep.find(r => r.id === job.originalInputResourceIds![0]);
                            if (originalResource) {
                                baseNameToMatch = getBaseNameForComparison(originalResource.original_name);
                            }
                        }
                        console.log(`Sequence: Base name to match for finding inputs for ${nextStepId}:`, baseNameToMatch);

                        // --- Find necessary inputs for the next step ---
                        for (const nextInputType of nextStepDef.inputs) {
                            let foundInputForType: Resource | null = null;

                            // 1. Check direct output of the completed step
                            //    (e.g., json_transcript from audio_to_transcript)
                            if (nextInputType === completedStepOutput) {
                                // Find *one* resource matching the type from the generated ones.
                                // Assumes the next step only needs one instance of this type.
                                const matchingGenerated = generatedResources.find(r => r.type === nextInputType);
                                if (matchingGenerated) {
                                    foundInputForType = matchingGenerated;
                                    console.log(`Sequence: Input ${nextInputType} found from direct output: ${foundInputForType.id}`);
                                }
                            }

                            // 2. If not found above, search *all* resources using the base name
                            //    (e.g., finding the 'audio' file using the base name when 'json_transcript' was just generated)
                            if (!foundInputForType && baseNameToMatch) {
                                const potentialMatches = currentResourcesAfterStep.filter(r =>
                                    r.type === nextInputType &&
                                    getBaseNameForComparison(r.original_name) === baseNameToMatch
                                );

                                if (potentialMatches.length === 1) {
                                    foundInputForType = potentialMatches[0];
                                    console.log(`Sequence: Input ${nextInputType} found by base name match: ${foundInputForType.id}`);
                                } else if (potentialMatches.length > 1) {
                                    // Sort by creation date descending (newest first) as a heuristic
                                    potentialMatches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                                    foundInputForType = potentialMatches[0]; // Take the newest
                                    console.warn(`Sequence: Ambiguous base name match for ${nextInputType} with base name ${baseNameToMatch}. Found ${potentialMatches.length} resources. Using the newest one: ${foundInputForType.id}`);
                                }
                                // else: potentialMatches.length === 0 -> still not found
                            }

                            // Add the found resource (if any) to the list for the next job
                            if (foundInputForType) {
                                if (!nextInputIds.includes(foundInputForType.id)) {
                                    nextInputResourcesFound.push(foundInputForType);
                                    nextInputIds.push(foundInputForType.id);
                                }
                            } else {
                                // Input genuinely couldn't be found
                                console.error(`Sequence Error: Could not find required input '${nextInputType}' for the next step '${nextStepId}' (Base name: ${baseNameToMatch}). Check resource list and naming conventions.`);
                                const errorKey = job.metaStepId || job.stepId;
                                // Be specific about which input failed
                                setStepErrors(prev => ({ ...prev, [errorKey]: `Sequence failed: Could not find input '${nextInputType}' for step '${nextStepDef.name}'.` }));
                                inputsMissingForNext = true;
                                break; // Stop looking for inputs for this next job
                            }
                        } // End loop through nextStepDef.inputs

                        // --- Create and queue the next job if all inputs were found ---
                        if (!inputsMissingForNext) {
                            const nextJob: ProcessingJob = {
                                stepId: nextStepId,
                                inputResourceIds: [...new Set(nextInputIds)], // Ensure unique IDs
                                inputOriginalNames: Object.fromEntries(nextInputResourcesFound.map(r => [r.id, r.original_name || r.filename])), // Use filename as fallback
                                apiKeys: nextStepDef.requiresKeys ? apiKeys : undefined,
                                metaStepId: job.metaStepId,
                                sequenceSteps: job.sequenceSteps,
                                currentSequenceIndex: nextSequenceIndex,
                                originalInputResourceIds: job.originalInputResourceIds,
                            };
                            console.log("Sequence: Queueing next job", nextJob);
                            setProcessingQueue(prev => [...prev, nextJob]);
                        } else {
                            setProcessingQueue([]); // Clear queue if next step cannot be prepared
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

        } catch (err: any) {
            console.error(`Error processing job ${job.stepId} (part of ${job.metaStepId || 'standalone'}):`, err);
            const errorKey = job.metaStepId || job.stepId;
            setStepErrors(prev => ({ ...prev, [errorKey]: `Step "${step.name}" failed: ${err.message}` }));
            setProcessingQueue([]);
        } finally {
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
    // *** MODIFY handleStartProcessing TO HANDLE META-STEPS ***
    const handleStartProcessing = useCallback((step: PipelineStep) => {
        setError(null);
        setStepErrors(prev => ({ ...prev, [step.id]: null })); // Clear previous errors for this step
        console.log(`Attempting to start step: ${step.id}`);
        console.log("Current selectedResourceIds:", selectedResourceIds);
        console.log("Current apiKeys:", apiKeys);

        const newJobs: ProcessingJob[] = [];
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));

        if (currentSelectedResources.length === 0) {
            setStepErrors(prev => ({ ...prev, [step.id]: "No resources selected." }));
            return;
        }

        // --- Handle Meta-Step ---
        if (step.sequence && step.sequence.length > 0) {
            const firstStepId = step.sequence[0];
            const firstStepDef = PIPELINE_STEPS.find(s => s.id === firstStepId);

            if (!firstStepDef) {
                const errorMsg = `Internal Error: First step '${firstStepId}' of sequence '${step.name}' not found.`;
                console.error(errorMsg);
                setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
                return;
            }

            // Initial input type for the *meta-step*
            const initialInputType = step.inputs[0];
            const selectedInitialInputs = currentSelectedResources.filter(r => r.type === initialInputType);

            if (selectedInitialInputs.length === 0) {
                const errorMsg = `Invalid selection for sequence "${step.name}". Select required input(s): ${step.inputs.join(', ')}.`;
                setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
                return;
            }

            // Create one sequence job chain for each selected initial input
            selectedInitialInputs.forEach(initialResource => {
                newJobs.push({
                    // Job targets the *first actual step*
                    stepId: firstStepId,
                    inputResourceIds: [initialResource.id],
                    inputOriginalNames: { [initialResource.id]: initialResource.original_name },
                    apiKeys: firstStepDef.requiresKeys ? apiKeys : undefined,
                    // --- Sequence Info ---
                    metaStepId: step.id,
                    sequenceSteps: step.sequence,
                    currentSequenceIndex: 0, // Start at index 0
                    originalInputResourceIds: [initialResource.id] // Track the initial input
                });
            });
            console.log(`Created ${newJobs.length} sequence job(s) starting with ${firstStepId}`);

        }
        // --- Handle Regular Multi-Input Step ---
        else if (step.multiInput && step.inputs.length > 0) {
            // Group selected resources by base name to find matching sets
            const groups: { [baseName: string]: { [type in ResourceTypeString]?: Resource } } = {};
            currentSelectedResources.forEach(res => {
                let base = getBaseNameForComparison(res.original_name);
                if (!base) base = `no_base_${res.id}`; // Handle potential empty base names
                if (!groups[base]) groups[base] = {};
                // Allow multiple resources of the same type for a base name? No, assume one for now.
                groups[base][res.type] = res;
            });

            Object.values(groups).forEach(group => {
                const hasAllInputs = step.inputs.every(inputType => group[inputType]);
                if (hasAllInputs) {
                    const inputResourcesForJob = step.inputs.map(inputType => group[inputType]!);
                    const inputIds = inputResourcesForJob.map(res => res.id);
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: inputIds,
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: Object.fromEntries(inputResourcesForJob.map(r => [r.id, r.original_name]))
                        // No sequence info for regular steps
                    });
                }
            });

            // Fallback: If grouping failed but exactly one of each required type is selected globally
            if (newJobs.length === 0) {
                const requiredInputsSelected = step.inputs.map(inputType =>
                    currentSelectedResources.filter(r => r.type === inputType)
                );
                const exactlyOneOfEachSelected = requiredInputsSelected.every(list => list.length === 1);
                const totalSelectedMatchesInputCount = currentSelectedResources.length === step.inputs.length;

                if (exactlyOneOfEachSelected && totalSelectedMatchesInputCount) {
                    console.log(`Grouping heuristic failed for step ${step.id}, using globally selected pair.`);
                    const inputResourcesForJob = requiredInputsSelected.map(list => list[0]);
                    const inputIds = inputResourcesForJob.map(res => res.id);
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: inputIds,
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: Object.fromEntries(inputResourcesForJob.map(r => [r.id, r.original_name]))
                    });
                }
            }
        }
        // --- Handle Regular Single-Input Step ---
        else if (step.inputs.length === 1) {
            const inputType = step.inputs[0];
            currentSelectedResources
                .filter(r => r.type === inputType)
                .forEach(resource => {
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: [resource.id],
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: { [resource.id]: resource.original_name }
                        // No sequence info for regular steps
                    });
                });
        }

        // --- Final Check and Queueing ---
        if (newJobs.length > 0) {
            setProcessingQueue(prev => [...prev, ...newJobs]);
        } else if (!step.sequence) { // Only show error if no jobs were created *and* it wasn't a meta-step (meta-step error handled above)
            const errorMsg = `Invalid selection for step "${step.name}". Select required input(s): ${step.inputs.join(', ')}. Check naming conventions for multi-input steps.`;
            setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
        }
    }, [selectedResourceIds, apiKeys, resources, getBaseNameForComparison]); // Added resources and getBaseNameForComparison


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

        try {
            // Use only the filled entries for the map
            const mapToSave = Object.fromEntries(filledEntries);
            const mapJsonString = JSON.stringify(mapToSave, null, 2);
            const blob = new Blob([mapJsonString], { type: 'application/json' });

            let baseName = "session"; // Default
            // Try to derive baseName from the *first* snippet being mapped
            if (snippetsForMapping.length > 0) {
                const firstSnippetOriginName = snippetsForMapping[0].original_name;
                // Use the robust getBaseNameForComparison utility
                const derivedBaseName = getBaseNameForComparison(firstSnippetOriginName);
                // Ensure it actually removed something, otherwise stick to default
                if (derivedBaseName && derivedBaseName !== firstSnippetOriginName.replace(/\.\w+$/, '')) {
                    baseName = derivedBaseName;
                }
                console.log("Derived base name for speaker map:", baseName);
            }
            const filename = `${baseName}_speaker_map.json`;

            const formData = new FormData();
            formData.append('file', blob, filename);

            console.log(`Uploading speaker map as ${filename}...`);
            const uploadedMapResource = await fetchApi<Resource>('/upload/json_speaker_map', {
                method: 'POST',
                body: formData,
            });

            if (uploadedMapResource) {
                // Fetch resources AND select the newly uploaded map
                await fetchResources([uploadedMapResource.id]);
                setShowSpeakerMapForm(false);
                setSnippetsForMapping([]);
                setSpeakerMapInput({});
                // Note: No automatic continuation of sequences here. User needs to manually start the next step (e.g., Transcript to Session)
            } else {
                throw new Error("Speaker map upload did not return resource details.");
            }
        } catch (err: any) {
            console.error("Failed to submit speaker map:", err);
            // Show error associated with the step that triggered the modal
            setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': `Failed to save speaker map: ${err.message}` }));
        }
    }, [speakerMapInput, snippetsForMapping, fetchResources, getBaseNameForComparison]); // Dependencies


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
