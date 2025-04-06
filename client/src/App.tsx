// client/src/App.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { FiUploadCloud, FiDownload, FiTrash2, FiPlay, FiPause, FiStopCircle, FiAlertTriangle, FiLoader } from 'react-icons/fi'; // Example icons

// --- Constants ---
const API_BASE_URL = 'http://127.0.0.1:8000'; // Your backend URL

// --- Types ---
type ResourceType =
    | 'video'
    | 'audio'
    | 'snippet'
    | 'json_transcript'
    | 'json_speaker_map'
    | 'text_session'
    | 'text_recap'
    | 'text_summary'
    | 'text_prompt';

interface Resource {
    id: string;
    original_name: string;
    type: ResourceType;
    filename: string; // e.g., "uuid.mp4"
}

interface PipelineStep {
    id: string; // e.g., "video_to_audio"
    name: string;
    inputs: ResourceType[];
    output: ResourceType;
    endpoint: string; // API endpoint path relative to base URL
    requiresKeys?: ('assemblyAi' | 'googleGemini')[];
    multiInput?: boolean; // Does it take multiple inputs (like transcript+audio)?
}

interface PreviewContent {
    type: 'text' | 'audio' | 'video_placeholder' | 'json' | 'unsupported';
    data: string | null; // URL for audio, text content for text/json
    error?: string;
}

interface ProcessingJob {
    stepId: string;
    // If multiInput is true, this will contain IDs for all required inputs
    // otherwise just the single input ID
    inputResourceIds: string[];
    // Store the specific API keys used for this job if required
    apiKeys?: { assemblyAi?: string; googleGemini?: string };
}

// --- Pipeline Definition ---
const PIPELINE_STEPS: PipelineStep[] = [
    {
        id: 'video_to_audio',
        name: '1. Video to Audio',
        inputs: ['video'],
        output: 'audio',
        endpoint: '/process/video_to_audio',
    },
    {
        id: 'audio_to_transcript',
        name: '2. Audio to Transcript',
        inputs: ['audio'],
        output: 'json_transcript',
        endpoint: '/process/audio_to_transcript',
        requiresKeys: ['assemblyAi'],
    },
    {
        id: 'transcript_to_snippets',
        name: '3. Transcript to Snippets',
        inputs: ['audio', 'json_transcript'],
        output: 'snippet', // Special case: generates multiple snippets
        endpoint: '/process/transcript_to_snippets',
        multiInput: true,
    },
    {
        id: 'transcript_to_session',
        name: '4. Transcript to Session',
        inputs: ['json_transcript', 'json_speaker_map'],
        output: 'text_session',
        endpoint: '/process/transcript_to_session',
        multiInput: true,
    },
    {
        id: 'session_to_recap',
        name: '5. Session to Recap',
        inputs: ['text_session', 'text_prompt'],
        output: 'text_recap',
        endpoint: '/process/session_to_recap',
        requiresKeys: ['googleGemini'],
        multiInput: true, // Takes session + prompt
    },
    {
        id: 'recap_to_summary',
        name: '6. Recap to Summary',
        inputs: ['text_recap', 'text_prompt'],
        output: 'text_summary',
        endpoint: '/process/recap_to_summary',
        requiresKeys: ['googleGemini'],
        multiInput: true, // Takes recap + prompt
    },
];

// --- API Helper Functions ---

async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: 'application/json', // Expect JSON by default
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            let errorDetail = `HTTP error! Status: ${response.status}`;
            try {
                const errorJson = await response.json();
                errorDetail = errorJson.detail || JSON.stringify(errorJson) || errorDetail;
            } catch (e) {
                // Ignore if response is not JSON
            }
            throw new Error(errorDetail);
        }

        // Handle cases where the response might be empty (e.g., DELETE)
        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return null as T; // Or an appropriate empty value
        }
        // Handle file downloads separately if needed, based on content-type
        if (response.headers.get('content-type')?.includes('application/octet-stream') ||
            response.headers.get('content-type')?.startsWith('audio/') ||
            response.headers.get('content-type')?.startsWith('video/') ||
            response.headers.get('content-type')?.startsWith('text/plain') ) {
             // For direct text/blob handling if required, but usually download links work better
             // const blob = await response.blob(); return blob as T;
             console.warn("API fetch received direct file data, but expected JSON or empty. Endpoint:", endpoint);
        }


        return response.json() as Promise<T>;
    } catch (error) {
        console.error(`API Error fetching ${url}:`, error);
        throw error; // Re-throw to be caught by calling function
    }
}

// --- Utility Functions ---

function getResourceTypeFromFilename(filename: string): ResourceType | null {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio'; // includes snippets
    if (ext === 'json') {
        // Basic heuristic - needs improvement if naming isn't consistent
        if (filename.includes('_transcript')) return 'json_transcript';
        if (filename.includes('_speaker_map')) return 'json_speaker_map';
        return 'json_transcript'; // Default guess for json
    }
    if (ext === 'txt') {
        if (filename.includes('_session')) return 'text_session';
        if (filename.includes('_recap')) return 'text_recap';
        if (filename.includes('_summary')) return 'text_summary';
        if (filename.includes('_prompt')) return 'text_prompt';
        return 'text_prompt'; // Default guess for text
    }
    return null;
}

function getBaseName(filename: string | undefined): string {
    if (!filename) return '';
    // Remove common suffixes added by the pipeline
    return filename
        .replace(/_transcript\.json$/, '')
        .replace(/_audio\.mp3$/, '')
        .replace(/_session_script\.txt$/, '')
        .replace(/_recap\.txt$/, '')
        .replace(/_summary\.txt$/, '')
        .replace(/_prompt\.txt$/, '')
        .replace(/_snippet\.mp3$/, '')
        .replace(/\.\w+$/, ''); // Remove final extension
}

// --- Main App Component ---
function App() {
    const [resources, setResources] = useState<Resource[]>([]);
    const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
    const [previewContent, setPreviewContent] = useState<{ [id: string]: PreviewContent }>({});
    const [isLoadingResources, setIsLoadingResources] = useState(true);
    const [isLoadingPreview, setIsLoadingPreview] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [apiKeys, setApiKeys] = useState<{ assemblyAi?: string; googleGemini?: string }>({});
    const [processingQueue, setProcessingQueue] = useState<ProcessingJob[]>([]);
    const [currentlyProcessing, setCurrentlyProcessing] = useState<ProcessingJob | null>(null);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null); // For single delete from list item
    const [showSpeakerMapForm, setShowSpeakerMapForm] = useState(false);
    const [snippetsForMapping, setSnippetsForMapping] = useState<Resource[]>([]);
    const [speakerMapInput, setSpeakerMapInput] = useState<{ [label: string]: string }>({});
    const [uploadError, setUploadError] = useState<string | null>(null);


    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Data Fetching ---
    const fetchResources = useCallback(async () => {
        setIsLoadingResources(true);
        setError(null);
        try {
            const data = await fetchApi<Resource[]>('/resources');
            setResources(data || []); // Handle null response if API returns empty list that way
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

    // --- Resource Selection & Preview ---
    const toggleResourceSelection = (id: string) => {
        setSelectedResourceIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const selectedResources = useMemo(() => {
        return resources.filter(r => selectedResourceIds.has(r.id));
    }, [resources, selectedResourceIds]);

    // Fetch preview content when selection changes
    useEffect(() => {
        const fetchPreview = async (resource: Resource) => {
             if (previewContent[resource.id] || isLoadingPreview.has(resource.id)) return; // Already loaded or loading

            setIsLoadingPreview(prev => new Set(prev).add(resource.id));
            let content: PreviewContent = { type: 'unsupported', data: null };
            const downloadUrl = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;

            try {
                if (resource.type.startsWith('text/') || resource.type.startsWith('json_')) {
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
                 console.error(`Error fetching preview for ${resource.id}:`, err);
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

    }, [selectedResources, previewContent, isLoadingPreview]);


    // --- Resource Actions (Upload, Download, Delete) ---

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setUploadError(null);
        if (acceptedFiles.length === 0) return;

        // You might want a loading indicator for uploads
        const uploadPromises = acceptedFiles.map(async (file) => {
            const resourceType = getResourceTypeFromFilename(file.name);
            if (!resourceType) {
                console.warn(`Skipping upload for ${file.name}: Unknown resource type.`);
                setUploadError(prev => `${prev ? prev + '\n' : ''}Skipped ${file.name}: Unknown type.`);
                return; // Skip this file
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                 await fetchApi(`/upload/${resourceType}`, {
                     method: 'POST',
                     body: formData,
                     // IMPORTANT: Don't set Content-Type header for FormData, browser does it correctly with boundary
                 });
             } catch (err: any) {
                 console.error(`Failed to upload ${file.name}:`, err);
                  setUploadError(prev => `${prev ? prev + '\n' : ''}Failed to upload ${file.name}: ${err.message}`);
             }
        });

        await Promise.all(uploadPromises);
        fetchResources(); // Refresh list after all uploads attempted
        // Clear upload error after a delay? Or require manual dismissal
        // setTimeout(() => setUploadError(null), 5000);

    }, [fetchResources]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true }); // Use button for click

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            onDrop(Array.from(event.target.files));
        }
        // Reset input value to allow selecting the same file again
        event.target.value = '';
    };

     const handleDownloadSelected = () => {
         if (selectedResources.length === 0) return;

         selectedResources.forEach(resource => {
             const link = document.createElement('a');
             link.href = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;
             link.download = resource.original_name || resource.filename; // Use original name if available
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
         });

         setSelectedResourceIds(new Set()); // Deselect after download
     };

     const handleDeleteSelected = () => {
         if (selectedResources.length === 0) return;
         setShowDeleteConfirmModal(true);
         // We'll delete multiple in the confirmation handler
         setResourceToDelete(null); // Ensure single delete state is clear
     };

      const confirmDeletion = async () => {
         const idsToDelete = resourceToDelete ? [resourceToDelete.id] : Array.from(selectedResourceIds);
         const resourcesToDelete = resourceToDelete ? [resourceToDelete] : selectedResources;

         if (idsToDelete.length === 0) return;

         setError(null); // Clear previous errors
         // Add a loading state for deletion if needed

         const deletePromises = resourcesToDelete.map(res =>
             fetchApi(`/resource/${res.type}/${res.id}`, { method: 'DELETE' })
                 .catch(err => {
                      console.error(`Failed to delete ${res.id} (${res.type}):`, err);
                      setError(prev => `${prev ? prev + '\n' : ''}Failed to delete ${res.original_name}: ${err.message}`);
                 })
         );

         await Promise.all(deletePromises);

         // Cleanup state
         setShowDeleteConfirmModal(false);
         setResourceToDelete(null);
         setSelectedResourceIds(prev => {
             const newSet = new Set(prev);
             idsToDelete.forEach(id => newSet.delete(id));
             return newSet;
         });
         fetchResources(); // Refresh the list
     };

     const cancelDeletion = () => {
          setShowDeleteConfirmModal(false);
          setResourceToDelete(null);
      };

      const handleDeleteClick = (e: React.MouseEvent, resource: Resource) => {
          e.stopPropagation(); // Prevent row selection when clicking delete icon
          setResourceToDelete(resource);
          setShowDeleteConfirmModal(true);
      }


    // --- Pipeline Processing ---

    const processJob = useCallback(async (job: ProcessingJob) => {
        setError(null);
        setCurrentlyProcessing(job);

        const step = PIPELINE_STEPS.find(s => s.id === job.stepId);
        if (!step) {
            console.error("Invalid step ID in job:", job.stepId);
            setError(`Internal error: Invalid step ID ${job.stepId}`);
            setCurrentlyProcessing(null); // Move to next if any
            return;
        }

        const formData = new FormData();
        const keyRequirements = step.requiresKeys || [];
        const jobKeys = job.apiKeys || {};

        // Add required API keys
        for (const keyName of keyRequirements) {
            const apiKey = keyName === 'assemblyAi' ? apiKeys.assemblyAi : apiKeys.googleGemini;
            if (!apiKey) {
                setError(`API Key "${keyName}" is required for step "${step.name}" but not provided.`);
                setCurrentlyProcessing(null);
                setProcessingQueue([]); // Clear queue as key is missing
                return;
            }
            formData.append(`${keyName}_api_key`, apiKey); // Backend expects snake_case keys
        }

        // Add input resource IDs
        // Backend needs to know which form field corresponds to which input type
        // Simple approach: use the resource type as the field name if only one input of that type
        // More robust: define specific field names in PipelineStep definition
        if (step.inputs.length === 1) {
            formData.append(`${step.inputs[0]}_id`, job.inputResourceIds[0]);
        } else if (step.multiInput) {
            // Assume order matches or use explicit naming (e.g., audio_id, transcript_id)
            // Let's try to map based on type (assuming unique input types for now)
            const resourcesForJob = resources.filter(r => job.inputResourceIds.includes(r.id));
            step.inputs.forEach(inputType => {
                const resource = resourcesForJob.find(r => r.type === inputType);
                if (resource) {
                     formData.append(`${inputType}_id`, resource.id);
                } else {
                     setError(`Internal error: Missing input resource of type ${inputType} for job ${job.stepId}`);
                     setCurrentlyProcessing(null);
                     setProcessingQueue([]);
                     return;
                }
            });
             if (step.id === 'session_to_recap' || step.id === 'recap_to_summary') {
                // Find the prompt specifically
                const promptResource = resourcesForJob.find(r => r.type === 'text_prompt');
                const mainInputResource = resourcesForJob.find(r => r.type !== 'text_prompt');
                if (promptResource && mainInputResource) {
                    // Backend endpoint likely expects specific names like 'session_id' or 'recap_id' and 'prompt_id'
                    formData.set(`${mainInputResource.type}_id`, mainInputResource.id); // e.g., text_session_id
                    formData.set(`prompt_id`, promptResource.id); // Adjust field name if backend expects this
                } else {
                     setError(`Internal error: Missing main input or prompt for job ${job.stepId}`);
                     setCurrentlyProcessing(null);
                     setProcessingQueue([]);
                     return;
                }
            }
        }


        try {
             console.log(`Calling endpoint ${step.endpoint} for job:`, job, "FormData:", Object.fromEntries(formData.entries()));
             // Response could be a single resource or map for snippets
             const result = await fetchApi<Resource | { [key: string]: Resource }>(step.endpoint, {
                 method: 'POST',
                 body: formData,
             });

            await fetchResources(); // Refresh resources list

            // Handle special case for transcript_to_snippets
             if (step.id === 'transcript_to_snippets' && typeof result === 'object' && result !== null) {
                 const generatedSnippets = Object.values(result as { [key: string]: Resource });
                 if (generatedSnippets.length > 0) {
                     setSnippetsForMapping(generatedSnippets);
                     setShowSpeakerMapForm(true);
                     // Automatically select the new snippets
                     setSelectedResourceIds(prev => new Set([...prev, ...generatedSnippets.map(s => s.id)]));
                 } else {
                     setError("Snippet generation finished but returned no snippets.");
                 }

             } else if (result && typeof result === 'object' && 'id' in result) {
                const newResource = result as Resource;
                // Select the newly created resource
                 setSelectedResourceIds(prev => new Set([...prev, newResource.id]));
            } else {
                // Handle cases where the endpoint might not return the created resource directly
                 console.log(`Step ${step.id} completed.`);
            }


        } catch (err: any) {
             console.error(`Error processing job ${job.stepId} for resources ${job.inputResourceIds.join(', ')}:`, err);
             setError(`Step "${step.name}" failed: ${err.message}`);
             setProcessingQueue([]); // Stop queue on error
        } finally {
             setCurrentlyProcessing(null);
        }

    }, [apiKeys, fetchResources, resources]); // Added 'resources' dependency

     // Effect to run the processing queue
     useEffect(() => {
         if (!currentlyProcessing && processingQueue.length > 0) {
             const nextJob = processingQueue[0];
             setProcessingQueue(prev => prev.slice(1)); // Dequeue
             processJob(nextJob);
         }
     }, [currentlyProcessing, processingQueue, processJob]);


     const handleStartProcessing = (step: PipelineStep) => {
         setError(null);
         const newJobs: ProcessingJob[] = [];

        // Find matching combinations of selected resources for the step's inputs
         if (step.multiInput && step.inputs.length > 0) {
             // More complex logic needed to find *sets* of inputs
             // Example: transcript_to_snippets (audio + json_transcript)
             const input1Resources = selectedResources.filter(r => r.type === step.inputs[0]);
             const input2Resources = selectedResources.filter(r => r.type === step.inputs[1]);

             // Try to pair them based on base names (simple heuristic)
             input1Resources.forEach(res1 => {
                 const baseName1 = getBaseName(res1.original_name);
                 const matchingRes2 = input2Resources.find(res2 => getBaseName(res2.original_name) === baseName1);
                 if (matchingRes2) {
                     newJobs.push({
                         stepId: step.id,
                         inputResourceIds: [res1.id, matchingRes2.id],
                         apiKeys: step.requiresKeys ? apiKeys : undefined
                     });
                 }
             });
             if (newJobs.length === 0 && input1Resources.length > 0 && input2Resources.length > 0) {
                 // Fallback: If no name match, maybe allow processing first pair found? Or require explicit pairing?
                 // For now, require name match heuristic. Add warning?
                  setError(`Could not automatically pair resources for step "${step.name}". Ensure base filenames match (e.g., 'session1_audio.mp3' and 'session1_transcript.json').`);
                  return;
             }

         } else if (step.inputs.length === 1) {
             // Simple case: one input type
             selectedResources
                 .filter(r => r.type === step.inputs[0])
                 .forEach(resource => {
                     newJobs.push({
                         stepId: step.id,
                         inputResourceIds: [resource.id],
                         apiKeys: step.requiresKeys ? apiKeys : undefined
                     });
                 });
         }


         if (newJobs.length > 0) {
             setProcessingQueue(prev => [...prev, ...newJobs]);
         } else {
             setError(`No selected resources match the input requirements for step "${step.name}".`);
         }
     };

     const handleStopProcessing = () => {
         setProcessingQueue([]); // Clear the queue
         // Note: This doesn't stop the *currently executing* backend process
         if (currentlyProcessing) {
             console.log("Processing queue stopped. Current job will finish.");
             // We could potentially add an abort signal here if the backend supports it
         }
     };


     // --- Speaker Map Form ---
     const handleSpeakerNameChange = (label: string, name: string) => {
         setSpeakerMapInput(prev => ({ ...prev, [label]: name }));
     };

    const submitSpeakerMap = async () => {
         if (Object.keys(speakerMapInput).length === 0) {
             setError("Please enter names for the speakers.");
             return;
         }
         setError(null);

         try {
             const mapJsonString = JSON.stringify(speakerMapInput);
             const blob = new Blob([mapJsonString], { type: 'application/json' });
             const filename = `${getBaseName(snippetsForMapping[0]?.original_name)}_speaker_map.json`; // Derive name
             const formData = new FormData();
             formData.append('file', blob, filename);

             const uploadedMapResource = await fetchApi<Resource>('/upload/json_speaker_map', {
                 method: 'POST',
                 body: formData,
             });

             if (uploadedMapResource) {
                 fetchResources(); // Refresh list
                 setShowSpeakerMapForm(false);
                 setSnippetsForMapping([]);
                 setSpeakerMapInput({});
                 // Optionally select the new map resource
                 setSelectedResourceIds(prev => new Set([...prev, uploadedMapResource.id]));
             } else {
                  throw new Error("Speaker map upload endpoint did not return resource details.");
             }
         } catch (err: any) {
             console.error("Failed to submit speaker map:", err);
             setError(`Failed to save speaker map: ${err.message}`);
         }
     };


     // --- Eligibility & Validation ---
     const checkStepEligibility = (step: PipelineStep): boolean => {
         if (selectedResourceIds.size === 0) return false;

         if (step.multiInput) {
             // Check if *at least one* resource of *each* required type is selected
             return step.inputs.every(inputType =>
                 selectedResources.some(r => r.type === inputType)
             );
         } else if (step.inputs.length === 1) {
             // Check if *at least one* resource of the required type is selected
             return selectedResources.some(r => r.type === step.inputs[0]);
         }
         return false; // Should not happen with valid step definition
     };

     // Check for potential filename mismatch for steps requiring audio+transcript
      const getFilenameMismatchWarning = (step: PipelineStep): string | null => {
          if (!step.multiInput || !step.inputs.includes('audio') || !step.inputs.includes('json_transcript')) {
              return null;
          }

          const selectedAudios = selectedResources.filter(r => r.type === 'audio');
          const selectedTranscripts = selectedResources.filter(r => r.type === 'json_transcript');

          if (selectedAudios.length === 1 && selectedTranscripts.length === 1) {
              const audioBase = getBaseName(selectedAudios[0].original_name);
              const transcriptBase = getBaseName(selectedTranscripts[0].original_name);
              if (audioBase !== transcriptBase) {
                   return `Warning: Selected audio (${selectedAudios[0].original_name}) and transcript (${selectedTranscripts[0].original_name}) base names do not match.`;
               }
          }
          // Could add logic for multiple selections, but becomes complex quickly
          return null;
      };


    // --- Rendering ---

    const renderPreview = (resource: Resource) => {
         const content = previewContent[resource.id];
         const isLoading = isLoadingPreview.has(resource.id);

         return (
             <div key={resource.id} className="mb-4 p-3 border rounded bg-white shadow-sm">
                 <h4 className="font-semibold text-sm mb-1 truncate" title={resource.original_name}>
                     {resource.original_name}
                 </h4>
                 <p className="text-xs text-gray-500 mb-2">{resource.type}</p>
                 {isLoading && <div className="text-center p-4"><FiLoader className="animate-spin inline-block mr-2" />Loading Preview...</div>}
                 {!isLoading && content && (
                     <>
                         {content.type === 'text' && <pre className="text-xs whitespace-pre-wrap break-words bg-gray-50 p-2 rounded max-h-60 overflow-y-auto">{content.data}</pre>}
                         {content.type === 'json' && <pre className="text-xs whitespace-pre-wrap break-words bg-gray-50 p-2 rounded max-h-60 overflow-y-auto">{tryFormatJson(content.data)}</pre>}
                         {content.type === 'audio' && content.data && <audio controls src={content.data} className="w-full"></audio>}
                         {content.type === 'video_placeholder' && <div className="text-center p-4 text-gray-400 text-sm">Video Preview Not Available</div>}
                         {content.type === 'unsupported' && <div className="text-center p-4 text-red-500 text-sm">{content.error || 'Preview not available'}</div>}
                     </>
                 )}
                {!isLoading && !content && <div className="text-center p-4 text-gray-400 text-sm">Select to load preview.</div> }

             </div>
         );
     };

    const tryFormatJson = (jsonString: string | null): string => {
        if (!jsonString) return '';
        try {
            return JSON.stringify(JSON.parse(jsonString), null, 2);
        } catch {
            return jsonString; // Return original if parsing fails
        }
    };

    // --- Main JSX Structure ---
    return (
        <div className="flex h-screen bg-gray-100">
            {/* --- Resources Panel (Left) --- */}
            <div className="w-1/4 p-4 border-r bg-white flex flex-col overflow-hidden">
                <h2 className="text-xl font-semibold mb-3">Resources</h2>
                <div className="flex space-x-2 mb-3">
                    <button
                        onClick={handleUploadClick}
                        className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm inline-flex items-center justify-center"
                        title="Upload Files"
                    >
                        <FiUploadCloud className="mr-1" /> Upload
                    </button>
                     {/* Hidden file input */}
                     <input
                         type="file"
                         multiple
                         ref={fileInputRef}
                         onChange={handleFileSelected}
                         className="hidden"
                         accept=".mp4,.mov,.avi,.mkv,.webm,.mp3,.wav,.ogg,.m4a,.flac,.json,.txt" // Adjust accepted types
                     />
                    <button
                        onClick={handleDownloadSelected}
                        disabled={selectedResources.length === 0}
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
                        title="Download Selected"
                    >
                        <FiDownload className="mr-1" /> Download
                    </button>
                    <button
                        onClick={handleDeleteSelected}
                        disabled={selectedResources.length === 0}
                        className="flex-1 bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
                         title="Delete Selected"
                   >
                         <FiTrash2 className="mr-1" /> Delete
                    </button>
                </div>

                 {/* Dropzone Area */}
                 <div
                    {...getRootProps()}
                    className={`flex-grow overflow-y-auto border-2 border-dashed rounded p-2 ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
                 >
                    <input {...getInputProps()} />
                     {isLoadingResources && <div className="text-center p-4 text-gray-500">Loading...</div>}
                     {!isLoadingResources && resources.length === 0 && !isDragActive && (
                         <p className="text-center text-gray-400 p-4">No resources found. Drag & drop files here or use the Upload button.</p>
                     )}
                      {!isLoadingResources && isDragActive && (
                          <p className="text-center text-blue-500 p-4 font-semibold">Drop files here...</p>
                      )}
                     {!isLoadingResources && resources.length > 0 && (
                         <ul className="space-y-1">
                             {resources.map(res => (
                                 <li
                                     key={res.id}
                                     onClick={() => toggleResourceSelection(res.id)}
                                     className={`p-2 text-sm rounded cursor-pointer flex justify-between items-center group ${
                                         selectedResourceIds.has(res.id) ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-gray-100'
                                     }`}
                                 >
                                     <span className="truncate flex-grow mr-2" title={res.original_name}>
                                         {res.original_name}
                                     </span>
                                     <span className="text-xs text-gray-500 mr-2 flex-shrink-0">{res.type}</span>
                                     <button
                                         onClick={(e) => handleDeleteClick(e, res)}
                                         className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                         title="Delete this resource"
                                      >
                                         <FiTrash2 />
                                     </button>
                                 </li>
                             ))}
                         </ul>
                     )}
                </div>
                 {uploadError && <div className="mt-2 p-2 text-xs text-red-700 bg-red-100 rounded whitespace-pre-wrap">{uploadError}</div>}
            </div>

             {/* --- Preview Panel (Middle) --- */}
             <div className="w-1/4 p-4 border-r bg-gray-50 overflow-y-auto">
                 <h2 className="text-xl font-semibold mb-3">Preview</h2>
                 {selectedResources.length === 0 && <p className="text-center text-gray-400 mt-10">Select a resource to preview</p>}
                 {selectedResources.map(renderPreview)}
            </div>


            {/* --- Pipeline Panel (Right) --- */}
            <div className="flex-grow p-4 flex flex-col items-center overflow-y-auto">
                <h2 className="text-xl font-semibold mb-3">Processing Pipeline</h2>

                {/* Global Error Display */}
                {error && <div className="w-full max-w-2xl mb-4 p-3 bg-red-100 text-red-700 rounded border border-red-300 text-sm">{error}</div>}


                {/* API Key Inputs */}
                 <div className="w-full max-w-2xl mb-6 p-4 border rounded bg-white shadow-sm">
                    <h3 className="text-lg font-medium mb-2">API Keys (Required for some steps)</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                             <label htmlFor="assemblyai-key" className="block text-sm font-medium text-gray-700 mb-1">AssemblyAI Key</label>
                             <input
                                 type="password" // Use password type for keys
                                 id="assemblyai-key"
                                 placeholder="Enter AssemblyAI API Key"
                                 value={apiKeys.assemblyAi || ''}
                                 onChange={(e) => setApiKeys(prev => ({ ...prev, assemblyAi: e.target.value }))}
                                 className="w-full p-1.5 border border-gray-300 rounded text-sm"
                             />
                         </div>
                         <div>
                              <label htmlFor="gemini-key" className="block text-sm font-medium text-gray-700 mb-1">Google Gemini Key</label>
                             <input
                                 type="password"
                                 id="gemini-key"
                                 placeholder="Enter Google Gemini API Key"
                                 value={apiKeys.googleGemini || ''}
                                 onChange={(e) => setApiKeys(prev => ({ ...prev, googleGemini: e.target.value }))}
                                 className="w-full p-1.5 border border-gray-300 rounded text-sm"
                             />
                         </div>
                     </div>
                 </div>

                {/* Stop Button */}
                {(currentlyProcessing || processingQueue.length > 0) && (
                    <button
                        onClick={handleStopProcessing}
                         className="mb-4 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-1.5 rounded text-sm inline-flex items-center justify-center"
                    >
                        <FiStopCircle className="mr-1" /> Stop Queue ({processingQueue.length} pending)
                    </button>
                 )}

                {/* Pipeline Steps */}
                <div className="w-full max-w-2xl space-y-4">
                     {PIPELINE_STEPS.map(step => {
                         const isEligible = checkStepEligibility(step);
                         const isProcessingThisStep = currentlyProcessing?.stepId === step.id || processingQueue.some(j => j.stepId === step.id);
                         const mismatchWarning = getFilenameMismatchWarning(step);

                         return (
                             <div key={step.id} className={`p-4 border rounded bg-white shadow-sm ${isEligible ? 'border-blue-300' : 'border-gray-200'}`}>
                                 <h3 className="text-lg font-medium mb-1">{step.name}</h3>
                                 <p className="text-xs text-gray-500 mb-2">
                                     Input: {step.inputs.join(', ')} &rarr; Output: {step.output}
                                      {step.requiresKeys && ` (Requires: ${step.requiresKeys.join(', ')})`}
                                 </p>
                                 {mismatchWarning && isEligible && (
                                     <p className="text-xs text-yellow-700 bg-yellow-100 p-1 rounded mb-2 inline-flex items-center">
                                         <FiAlertTriangle className="mr-1 flex-shrink-0" /> {mismatchWarning}
                                     </p>
                                 )}
                                 <button
                                     onClick={() => handleStartProcessing(step)}
                                     disabled={!isEligible || isProcessingThisStep}
                                     className={`w-full bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center ${isProcessingThisStep ? 'bg-gray-400 hover:bg-gray-400' : ''}`}
                                 >
                                     {isProcessingThisStep ? (
                                         <>
                                             <FiLoader className="animate-spin mr-2" /> Processing...
                                         </>
                                     ) : (
                                         'Start Step'
                                     )}
                                 </button>
                             </div>
                         );
                    })}
                </div>

                {/* Speaker Map Form */}
                {showSpeakerMapForm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
                         <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                            <h2 className="text-xl font-semibold mb-4">Identify Speakers</h2>
                             <p className="text-sm text-gray-600 mb-4">Listen to the snippets and enter the name for each speaker label.</p>
                             <div className="space-y-3">
                                 {snippetsForMapping.map(snippet => {
                                     // Extract speaker label (e.g., 'A', 'B') from filename heuristic
                                     const match = snippet.original_name.match(/_speaker_([A-Z])_/i);
                                     const label = match ? match[1].toUpperCase() : 'Unknown';
                                      return (
                                          <div key={snippet.id} className="flex items-center space-x-3 border-b pb-2">
                                              <span className="font-mono font-bold w-8 text-center">{label}:</span>
                                              <input
                                                  type="text"
                                                  placeholder="Enter Speaker Name"
                                                  value={speakerMapInput[label] || ''}
                                                  onChange={(e) => handleSpeakerNameChange(label, e.target.value)}
                                                  className="flex-grow p-1.5 border border-gray-300 rounded text-sm"
                                              />
                                              <audio controls src={`${API_BASE_URL}/download/snippet/${snippet.id}`} className="h-8"></audio>
                                          </div>
                                      );
                                  })}
                             </div>
                             <div className="mt-6 flex justify-end space-x-3">
                                 <button
                                      onClick={() => setShowSpeakerMapForm(false)}
                                      className="bg-gray-300 hover:bg-gray-400 text-black px-4 py-1.5 rounded text-sm"
                                  >
                                      Cancel
                                  </button>
                                  <button
                                      onClick={submitSpeakerMap}
                                      className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm"
                                  >
                                      Save Speaker Map
                                  </button>
                              </div>
                         </div>
                    </div>
                 )}


                 {/* Delete Confirmation Modal */}
                 {showDeleteConfirmModal && (
                     <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                         <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
                             <h2 className="text-lg font-semibold mb-4">Confirm Deletion</h2>
                             <p className="text-sm text-gray-700 mb-6">
                                 {resourceToDelete
                                     ? `Are you sure you want to permanently delete "${resourceToDelete.original_name}"?`
                                     : `Are you sure you want to permanently delete the ${selectedResources.length} selected resource(s)?`}
                                 <br />This action cannot be undone.
                            </p>
                             <div className="flex justify-end space-x-3">
                                 <button
                                     onClick={cancelDeletion}
                                     className="bg-gray-300 hover:bg-gray-400 text-black px-4 py-1.5 rounded text-sm"
                                 >
                                     Cancel
                                 </button>
                                 <button
                                     onClick={confirmDeletion}
                                     className="bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded text-sm"
                                 >
                                     Delete
                                 </button>
                             </div>
                         </div>
                     </div>
                 )}

            </div> {/* End Pipeline Panel */}
        </div> // End Main Flex Container
    );
}

export default App;