// client/src/App.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { FiAlertTriangle, FiLoader, FiInfo } from 'react-icons/fi';

// Import the new components
import { ResourcesPanel } from './components/ResourcesPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { PipelinePanel } from './components/PipelinePanel';

// Import types (assuming they are in src/types.ts)
import { Resource, ResourceTypeString, PipelineStep, PreviewContent, ProcessingJob } from './types';

// --- Constants ---
// Keep constants, types, pipeline definition etc. here for now
const API_BASE_URL = 'http://127.0.0.1:8000';
const ACCEPTED_FILE_TYPES = ".mp4,.mov,.avi,.mkv,.webm,.mp3,.wav,.ogg,.m4a,.flac,.json,.txt"; // Define accepted types

// --- Types --- moved to src/types.ts

// --- Pipeline Definition ---
const PIPELINE_STEPS: PipelineStep[] = [
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

// --- API Helper Functions ---
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
                // Check content type before parsing JSON
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    errorJson = await response.json();
                    errorDetail = errorJson.detail || JSON.stringify(errorJson) || errorDetail;
                } else {
                    // Try reading as text for non-JSON errors
                    const textError = await response.text();
                    errorDetail = textError || errorDetail;
                }

            } catch (e) {
                console.warn("Could not parse error response body:", e)
            }
            console.error(`API Error Response (${url}):`, errorDetail, errorJson); // Log detailed error
            throw new Error(errorDetail); // Throw the detailed message
        }

        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return null as T;
        }

        // Assuming successful responses are JSON unless handled otherwise (like downloads)
        return response.json() as Promise<T>;

    } catch (error) {
        console.error(`API Fetch Error (${url}):`, error);
        // Ensure we throw an Error object with a message
        if (error instanceof Error) {
            throw error;
        } else {
            throw new Error(String(error));
        }
    }
}

// --- Utility Functions ---
// Keep utility functions here for now, or move to utils.ts
const getBaseNameForComparison = (filename: string | undefined): string => {
    // ... same as before ...
    if (!filename) return '';
    // Remove known suffixes first, then the final extension
    return filename
        .replace('_audio', '')
        .replace('_transcript', '')
        .replace('_session_script', '')
        .replace('_recap', '')
        .replace('_summary', '')
        .replace('_prompt', '')
        .replace('_snippet', '')
        .replace('_speaker_map', '')
        .replace(/\.\w+$/, ''); // Remove final extension
};

// --- Simple Path.stem equivalent --- (Should be in utils)
namespace Path { export function stem(filename: string): string { const parts = filename.split('.'); parts.pop(); return parts.join('.'); } }

// --- tryFormatJson --- (Should be in utils)
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
    // --- State Declarations ---
    // Keep ALL state here for now
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
    // Keep ALL logic here for now

    const fetchResources = useCallback(async () => {
        setIsLoadingResources(true);
        try {
            const data = await fetchApi<Resource[]>('/resources');
            setResources(data || []);
        } catch (err: any) {
            setError(`Failed to fetch resources: ${err.message}`);
            setResources([]);
        } finally {
            setIsLoadingResources(false);
        }
    }, []);

    useEffect(() => {
        fetchResources();
    }, [fetchResources]);

    const toggleResourceSelection = useCallback((id: string) => { // Use useCallback
        setSelectedResourceIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
        setStepErrors({}); // Clear step errors on selection change
    }, []); // Add dependency array if needed, empty is fine here

    const selectedResources = useMemo(() => {
        return resources.filter(r => selectedResourceIds.has(r.id));
    }, [resources, selectedResourceIds]);

    // --- Preview Fetching Effect ---
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

        selectedResources.forEach(fetchPreview);

    }, [selectedResources, previewContent, isLoadingPreview]); // Dependencies remain correct


    // --- Upload Logic ---
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
            if (ext === 'json') return 'json_transcript';
            if (ext === 'txt') return 'text_session';
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
        fetchResources();
        setTimeout(() => setUploadProgress(null), 1500);

    }, [fetchResources]); // fetchResources dependency

    // --- Dropzone Hook ---
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        noClick: true,
        multiple: true,
        accept: ACCEPTED_FILE_TYPES.split(',').reduce((acc, ext) => { // Generate accept prop dynamically
            acc[ext.trim()] = [];
            return acc;
        }, {} as Record<string, string[]>),
    });

    // --- Click/Select Handlers ---
    const handleUploadClick = useCallback(() => { // Use useCallback
        fileInputRef.current?.click();
    }, []);

    const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => { // Use useCallback
        if (event.target.files) {
            onDrop(Array.from(event.target.files));
        }
        event.target.value = ''; // Reset file input
    }, [onDrop]);

    const handleDownloadSelected = useCallback(() => { // Use useCallback
        if (selectedResources.length === 0) return;
        selectedResources.forEach(resource => {
            const link = document.createElement('a');
            link.href = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;
            link.download = resource.original_name || resource.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
        setSelectedResourceIds(new Set()); // Clear selection after download
    }, [selectedResources]); // Dependency on selectedResources

    const handleDeleteSelected = useCallback(() => { // Use useCallback
        if (selectedResources.length === 0) return;
        setShowDeleteConfirmModal(true);
        setResourceToDelete(null); // Indicate deleting selection
    }, [selectedResources]); // Dependency on selectedResources

    const confirmDeletion = useCallback(async () => { // Use useCallback
        const idsToDelete = resourceToDelete ? [resourceToDelete.id] : Array.from(selectedResourceIds);
        const resourcesToDelete = resourceToDelete ? [resourceToDelete] : selectedResources;

        if (idsToDelete.length === 0) return;

        setError(null);
        let deleteErrors = "";

        const deletePromises = resourcesToDelete.map(res =>
            fetchApi(`/resource/${res.type}/${res.id}`, { method: 'DELETE' })
                .catch(err => {
                    console.error(`Failed to delete ${res.original_name} (ID: ${res.id}):`, err);
                    deleteErrors += `Failed to delete ${res.original_name}: ${err.message}\n`;
                })
        );

        await Promise.all(deletePromises);

        if (deleteErrors) {
            setError(deleteErrors.trim());
        }

        setShowDeleteConfirmModal(false);
        setResourceToDelete(null);
        setSelectedResourceIds(prev => { // Optimistic update of selection
            const newSet = new Set(prev);
            idsToDelete.forEach(id => newSet.delete(id));
            return newSet;
        });
        fetchResources(); // Refresh the list
    }, [resourceToDelete, selectedResourceIds, selectedResources, fetchResources]); // Dependencies

    const cancelDeletion = useCallback(() => { // Use useCallback
        setShowDeleteConfirmModal(false);
        setResourceToDelete(null);
    }, []);

    const handleDeleteClick = useCallback((e: React.MouseEvent, resource: Resource) => { // Use useCallback
        e.stopPropagation(); // Prevent triggering row selection
        setResourceToDelete(resource);
        setShowDeleteConfirmModal(true);
    }, []);

    // --- Pipeline Processing Logic ---
    const processJob = useCallback(async (job: ProcessingJob) => {
        setStepErrors(prev => ({ ...prev, [job.stepId]: null }));
        setCurrentlyProcessing(job);

        const step = PIPELINE_STEPS.find(s => s.id === job.stepId);
        if (!step) {
            const errorMsg = `Internal error: Invalid step ID ${job.stepId}`;
            console.error(errorMsg);
            setError(errorMsg);
            setCurrentlyProcessing(null);
            setProcessingQueue([]); // Clear queue on internal error
            return;
        }

        const formData = new FormData();
        const keyRequirements = step.requiresKeys || [];

        for (const keyName of keyRequirements) {
            const apiKey = keyName === 'assemblyAi' ? apiKeys.assemblyAi : apiKeys.googleGemini;
            if (!apiKey) {
                const errorMsg = `API Key "${keyName}" is required for step "${step.name}".`;
                setStepErrors(prev => ({ ...prev, [job.stepId]: errorMsg }));
                setCurrentlyProcessing(null);
                setProcessingQueue([]); // Clear queue
                return;
            }
            const backendKeyName = keyName === 'assemblyAi' ? 'assemblyai_api_key' : 'google_gemini_api_key';
            formData.append(backendKeyName, apiKey);
        }

        const inputResources = resources.filter(r => job.inputResourceIds.includes(r.id));
        let missingInput = false;
        step.inputs.forEach(inputType => {
            const resource = inputResources.find(r => r.type === inputType);
            if (resource) {
                const fieldName = step.inputFieldNames?.[inputType] || `${inputType}_id`;
                formData.append(fieldName, resource.id);
            } else {
                const errorMsg = `Internal error: Missing required input of type '${inputType}' for step "${step.name}".`;
                setStepErrors(prev => ({ ...prev, [job.stepId]: errorMsg }));
                missingInput = true;
            }
        });

        if (missingInput) {
            setCurrentlyProcessing(null);
            setProcessingQueue([]);
            return;
        }

        try {
            console.log(`Calling endpoint ${step.endpoint} for job:`, job);
            console.log("FormData being sent:", Object.fromEntries(formData.entries()));

            const result = await fetchApi<Resource | { [key: string]: Resource }>(step.endpoint, {
                method: 'POST',
                body: formData,
            });

            await fetchResources(); // Use await to ensure list is updated before potential next step

            let newResourceIds: string[] = [];
            if (step.id === 'transcript_to_snippets' && typeof result === 'object' && result !== null) {
                const generatedSnippets = Object.values(result as { [key: string]: Resource });
                if (generatedSnippets.length > 0) {
                    setSnippetsForMapping(generatedSnippets);
                    setShowSpeakerMapForm(true);
                    newResourceIds = generatedSnippets.map(s => s.id);
                } else {
                    setStepErrors(prev => ({ ...prev, [job.stepId]: "Snippet generation returned no snippets." }));
                }
            } else if (result && typeof result === 'object' && 'id' in result) {
                const newResource = result as Resource;
                newResourceIds = [newResource.id];
            } else {
                console.log(`Step ${step.id} completed, no specific resource returned.`);
            }

            // Select newly created resources
            if (newResourceIds.length > 0) {
                setSelectedResourceIds(prev => new Set([...Array.from(prev), ...newResourceIds]));
            }

        } catch (err: any) {
            console.error(`Error processing job ${job.stepId}:`, err);
            setStepErrors(prev => ({ ...prev, [job.stepId]: `Step "${step.name}" failed: ${err.message}` }));
            setProcessingQueue([]); // Stop queue on error
        } finally {
            setCurrentlyProcessing(null);
        }

    }, [apiKeys, fetchResources, resources]); // Dependencies

    // --- Queue Runner Effect ---
    useEffect(() => {
        if (!currentlyProcessing && processingQueue.length > 0) {
            const nextJob = processingQueue[0];
            setProcessingQueue(prev => prev.slice(1));
            processJob(nextJob);
        }
    }, [currentlyProcessing, processingQueue, processJob]); // Dependencies

    // --- Start/Stop Processing Handlers ---
    const handleStartProcessing = useCallback((step: PipelineStep) => {
        setError(null);
        setStepErrors(prev => ({ ...prev, [step.id]: null }));
        console.log(`Attempting to start step: ${step.id}`);
        console.log("Current selectedResourceIds:", selectedResourceIds);
        console.log("Current apiKeys:", apiKeys);

        const newJobs: ProcessingJob[] = [];
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));

        if (step.multiInput && step.inputs.length > 0) {
            const groups: { [baseName: string]: { [type in ResourceTypeString]?: Resource } } = {};
            currentSelectedResources.forEach(res => {
                let base = getBaseNameForComparison(res.original_name);
                if (!groups[base]) groups[base] = {};
                groups[base][res.type] = res;
            });

            Object.values(groups).forEach(group => {
                const hasAllInputs = step.inputs.every(inputType => group[inputType]);
                if (hasAllInputs) {
                    const inputIds = step.inputs.map(inputType => group[inputType]!.id);
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: inputIds,
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: Object.fromEntries(inputIds.map(id => [id, resources.find(r => r.id === id)?.original_name || '']))
                    });
                }
            });

            // Fallback: If heuristic failed but exactly one of each required type is selected
            if (newJobs.length === 0) {
                const requiredInputsSelected = step.inputs.map(inputType =>
                    currentSelectedResources.filter(r => r.type === inputType)
                );
                const exactlyOneOfEachSelected = requiredInputsSelected.every(list => list.length === 1);

                if (exactlyOneOfEachSelected) {
                    console.log(`Pairing heuristic failed for step ${step.id}, using selected pair.`);
                    const inputIds = requiredInputsSelected.map(list => list[0].id);
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: inputIds,
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: Object.fromEntries(inputIds.map(id => [id, resources.find(r => r.id === id)?.original_name || '']))
                    });
                }
            }

        } else if (step.inputs.length === 1) {
            currentSelectedResources
                .filter(r => r.type === step.inputs[0])
                .forEach(resource => {
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: [resource.id],
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: { [resource.id]: resource.original_name }
                    });
                });
        }

        // --- Final Check and Queueing ---
        if (newJobs.length > 0) {
            setProcessingQueue(prev => [...prev, ...newJobs]);
        } else {
            const errorMsg = `Invalid selection for step "${step.name}". Select required input(s): ${step.inputs.join(', ')}.`;
            setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
        }
    }, [selectedResourceIds, apiKeys, resources]); // Dependencies

    const handleStopProcessing = useCallback(() => { // Use useCallback
        setProcessingQueue([]);
        if (currentlyProcessing) {
            console.log("Processing queue stopped. Current job will finish.");
        }
    }, [currentlyProcessing]); // Dependency

    // --- Speaker Map Logic ---
    const handleSpeakerNameChange = useCallback((label: string, name: string) => { // Use useCallback
        setSpeakerMapInput(prev => ({ ...prev, [label]: name }));
    }, []);

    const submitSpeakerMap = useCallback(async () => { // Use useCallback
        if (Object.keys(speakerMapInput).length === 0) {
            setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': "Please enter names for the speakers." }));
            return;
        }
        setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': null }));

        try {
            const mapJsonString = JSON.stringify(speakerMapInput, null, 2);
            const blob = new Blob([mapJsonString], { type: 'application/json' });

            let baseName = "session";
            if (snippetsForMapping.length > 0) {
                // Find the resource (likely transcript or audio) that led to these snippets
                // This requires knowing the inputResourceIds of the job that created the snippets
                // For simplicity now, use the first snippet's base name, assuming consistency
                const firstSnippetOriginName = snippetsForMapping[0].original_name;
                // Attempt to strip known snippet suffixes robustly
                baseName = firstSnippetOriginName
                    .replace(/_speaker_[A-Z]_snippet\.mp3$/i, '') // Remove speaker snippet suffix
                    .replace(/_snippet\.mp3$/i, ''); // Remove generic snippet suffix (fallback)

                // If still unsure, could try finding the original audio/transcript via job history if stored
                // Or default to "session"
                if (baseName === firstSnippetOriginName) baseName = "session"; // Reset if replace failed
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
                await fetchResources(); // Ensure resource list is updated
                setShowSpeakerMapForm(false);
                setSnippetsForMapping([]);
                setSpeakerMapInput({});
                setSelectedResourceIds(prev => new Set([...Array.from(prev), uploadedMapResource.id])); // Select the new map
            } else {
                throw new Error("Speaker map upload did not return resource details.");
            }
        } catch (err: any) {
            console.error("Failed to submit speaker map:", err);
            setStepErrors(prev => ({ ...prev, 'transcript_to_snippets': `Failed to save speaker map: ${err.message}` }));
        }
    }, [speakerMapInput, snippetsForMapping, fetchResources]); // Dependencies

    // --- Eligibility & Validation Logic ---
    const checkStepEligibility = useCallback((step: PipelineStep): boolean => { // Use useCallback
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
        if (currentSelectedResources.length === 0) return false;

        if (step.multiInput) {
            return step.inputs.every(inputType =>
                currentSelectedResources.some(r => r.type === inputType)
            );
        } else if (step.inputs.length === 1) {
            return currentSelectedResources.some(r => r.type === step.inputs[0]);
        }
        return false;
    }, [resources, selectedResourceIds]); // Dependencies

    const getFilenameMismatchWarning = useCallback((step: PipelineStep): string | null => { // Use useCallback
        if (!step.multiInput || !step.inputs.includes('audio') || !step.inputs.includes('json_transcript')) {
            return null;
        }
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
        const selectedAudios = currentSelectedResources.filter(r => r.type === 'audio');
        const selectedTranscripts = currentSelectedResources.filter(r => r.type === 'json_transcript');

        if (selectedAudios.length === 1 && selectedTranscripts.length === 1) {
            const audioBase = getBaseNameForComparison(selectedAudios[0].original_name);
            const transcriptBase = getBaseNameForComparison(selectedTranscripts[0].original_name);

            if (audioBase !== transcriptBase) {
                return `Warning: Selected audio (${selectedAudios[0].original_name}) and transcript (${selectedTranscripts[0].original_name}) may not match.`;
            }
        }
        return null;
    }, [resources, selectedResourceIds]); // Dependencies


    // --- API Key Change Handler ---
    const handleApiKeyChange = useCallback((keyName: 'assemblyAi' | 'googleGemini', value: string) => {
        setApiKeys(prev => ({ ...prev, [keyName]: value }));
    }, []);

    // --- Render Preview Function (passed down) ---
    const renderPreview = useCallback((resource: Resource) => {
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
                {!isLoading && !content && <div className="text-center p-4 text-gray-400 dark:text-gray-500 text-sm">Select resource to load preview.</div>}
            </div>
        );
    }, [previewContent, isLoadingPreview]); // Dependencies


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
                selectedResources={selectedResources}
                renderPreview={renderPreview}
            />

            {/* --- Pipeline Panel (Right) --- */}
            <PipelinePanel
                error={error}
                apiKeys={apiKeys}
                onApiKeyChange={handleApiKeyChange}
                currentlyProcessing={currentlyProcessing}
                processingQueue={processingQueue}
                onStopProcessing={handleStopProcessing}
                pipelineSteps={PIPELINE_STEPS}
                stepErrors={stepErrors}
                onStartProcessing={handleStartProcessing}
                checkStepEligibility={checkStepEligibility}
                getFilenameMismatchWarning={getFilenameMismatchWarning}
            />

            {/* --- Modals (Keep in App.tsx for now) --- */}
            {showSpeakerMapForm && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-40">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Identify Speakers</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Listen to snippets and enter speaker names.</p>
                        {stepErrors['transcript_to_snippets'] && (
                            <p className="text-xs text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/50 p-1.5 rounded mb-3 inline-flex items-center border border-red-300 dark:border-red-700">
                                <span className="mr-1 flex-shrink-0"><FiAlertTriangle /></span> {stepErrors['transcript_to_snippets']}
                            </p>
                        )}
                        <div className="space-y-3">
                            {snippetsForMapping.map(snippet => {
                                const match = snippet.original_name.match(/_speaker_([A-Z])_/i);
                                const label = match ? match[1].toUpperCase() : 'Unknown';
                                return (
                                    <div key={snippet.id} className="flex items-center space-x-3 border-b dark:border-gray-700 pb-3">
                                        <label htmlFor={`speaker-input-${label}`} className="font-mono font-bold w-8 text-center text-gray-700 dark:text-gray-300">{label}:</label>
                                        <input
                                            type="text"
                                            id={`speaker-input-${label}`}
                                            placeholder="Enter Speaker Name"
                                            value={speakerMapInput[label] || ''}
                                            onChange={(e) => handleSpeakerNameChange(label, e.target.value)}
                                            className="flex-grow p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        />
                                        <audio controls src={`${API_BASE_URL}/download/snippet/${snippet.id}`} className="h-8"></audio>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-6 flex justify-end space-x-3">
                            <button onClick={() => setShowSpeakerMapForm(false)} className="bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-black dark:text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" > Cancel </button>
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
                                ? <>Are you sure you want to permanently delete <strong className='font-medium'>"{resourceToDelete.original_name}"</strong>?</>
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