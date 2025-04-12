// client/src/App.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { FiUploadCloud, FiDownload, FiTrash2, FiPlay, FiPause, FiStopCircle, FiAlertTriangle, FiLoader, FiInfo } from 'react-icons/fi';

// --- Constants ---
const API_BASE_URL = 'http://127.0.0.1:8000';
const FILENAME_SEPARATOR = "__"; // Must match backend

// --- Types ---
// (ResourceType enum can be removed if not used directly, rely on string type)
type ResourceTypeString =
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
    id: string;            // UUID
    original_name: string; // User-facing name (e.g., uploaded.mp4, uploaded_audio.mp3)
    type: ResourceTypeString;
    filename: string;      // Name on disk (e.g., uuid__uploaded.mp4)
}

// (PipelineStep, PreviewContent, ProcessingJob interfaces remain the same)
interface PipelineStep {
    id: string;
    name: string;
    inputs: ResourceTypeString[];
    output: ResourceTypeString;
    endpoint: string;
    requiresKeys?: ('assemblyAi' | 'googleGemini')[];
    multiInput?: boolean;
    inputFieldNames?: { [key in ResourceTypeString]?: string }; // Optional: Define specific form field names if needed
}

interface PreviewContent {
    type: 'text' | 'audio' | 'video_placeholder' | 'json' | 'unsupported';
    data: string | null;
    error?: string;
}

interface ProcessingJob {
    stepId: string;
    inputResourceIds: string[];
    apiKeys?: { assemblyAi?: string; googleGemini?: string };
    // Store original names of inputs for better output naming context if needed
    inputOriginalNames?: { [id: string]: string };
}


// --- Pipeline Definition ---
// Add specific input field names where needed (matching backend Form(...) names)
const PIPELINE_STEPS: PipelineStep[] = [
    {
        id: 'video_to_audio', name: '1. Video to Audio', inputs: ['video'], output: 'audio', endpoint: '/process/video_to_audio',
        inputFieldNames: { video: 'video_id' }
    },
    {
        id: 'audio_to_transcript', name: '2. Audio to Transcript', inputs: ['audio'], output: 'json_transcript', endpoint: '/process/audio_to_transcript', requiresKeys: ['assemblyAi'],
        inputFieldNames: { audio: 'audio_id' } // Backend expects 'audio_id'
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
        // Backend expects 'text_session_id' and 'prompt_id' based on our backend update
        inputFieldNames: { text_session: 'text_session_id', text_prompt: 'prompt_id' }
    },
    {
        id: 'recap_to_summary', name: '6. Recap to Summary', inputs: ['text_recap', 'text_prompt'], output: 'text_summary', endpoint: '/process/recap_to_summary', requiresKeys: ['googleGemini'], multiInput: true,
        // Backend expects 'text_recap_id' and 'prompt_id' based on our backend update
        inputFieldNames: { text_recap: 'text_recap_id', text_prompt: 'prompt_id' }
    },
];

// --- API Helper Functions ---
// Improved error handling
async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
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

// Helper function specifically for comparing base names for warnings
const getBaseNameForComparison = (filename: string | undefined): string => {
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

// --- Utility Functions ---
// Updated getBaseName to handle the new format if needed, but parsing __ might be complex here.
// Let's primarily rely on the backend providing a good original_name.
function getBaseName(filename: string | undefined): string {
    if (!filename) return '';
    // If filename includes separator, try using the part after it
    if (filename.includes(FILENAME_SEPARATOR)) {
        const namePart = filename.split(FILENAME_SEPARATOR, 1)[1] || filename;
        return Path.stem(namePart); // Use Path lib if available or simple splitext
    }
    // Fallback for old format or simple names
    return filename.replace(/\.\w+$/, ''); // Remove final extension
}
// Simple Path.stem equivalent
namespace Path { export function stem(filename: string): string { const parts = filename.split('.'); parts.pop(); return parts.join('.'); }}

// --- Main App Component ---
function App() {
    // ... (useState declarations remain mostly the same) ...
    const [resources, setResources] = useState<Resource[]>([]);
    const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
    const [previewContent, setPreviewContent] = useState<{ [id: string]: PreviewContent }>({});
    const [isLoadingResources, setIsLoadingResources] = useState(true);
    const [isLoadingPreview, setIsLoadingPreview] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null); // Store general errors
    const [stepErrors, setStepErrors] = useState<{ [stepId: string]: string | null }>({}); // Errors specific to steps
    const [apiKeys, setApiKeys] = useState<{ assemblyAi?: string; googleGemini?: string }>({});
    const [processingQueue, setProcessingQueue] = useState<ProcessingJob[]>([]);
    const [currentlyProcessing, setCurrentlyProcessing] = useState<ProcessingJob | null>(null);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
    const [showSpeakerMapForm, setShowSpeakerMapForm] = useState(false);
    const [snippetsForMapping, setSnippetsForMapping] = useState<Resource[]>([]);
    const [speakerMapInput, setSpeakerMapInput] = useState<{ [label: string]: string }>({});
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null); // For potential progress bar

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Data Fetching ---
    const fetchResources = useCallback(async () => {
        setIsLoadingResources(true);
        // Don't clear general error on auto-refresh maybe
        // setError(null);
        try {
            const data = await fetchApi<Resource[]>('/resources');
            setResources(data || []);
        } catch (err: any) {
            setError(`Failed to fetch resources: ${err.message}`); // Show fetch error prominently
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
        // Clear step-specific errors when selection changes
        setStepErrors({});
    };

    const selectedResources = useMemo(() => {
        return resources.filter(r => selectedResourceIds.has(r.id));
    }, [resources, selectedResourceIds]);

    // Fetch preview content effect remains largely the same...
     useEffect(() => {
         const fetchPreview = async (resource: Resource) => {
              if (previewContent[resource.id] || isLoadingPreview.has(resource.id)) return;

             setIsLoadingPreview(prev => new Set(prev).add(resource.id));
             let content: PreviewContent = { type: 'unsupported', data: null };
             // Use resource.id (UUID) for the download URL
             const downloadUrl = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;

             try {
                 if (resource.type.startsWith('text_') || resource.type.startsWith('json_')) {
                      const response = await fetch(downloadUrl); // Fetch directly
                      if (!response.ok) throw new Error(`HTTP ${response.status}`);
                      const textData = await response.text();
                      content = {
                          type: resource.type.startsWith('json_') ? 'json' : 'text',
                          data: textData,
                      };
                 } else if (resource.type === 'audio' || resource.type === 'snippet') {
                     // For audio, just provide the URL to the <audio> tag
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

     }, [selectedResources, previewContent, isLoadingPreview]);


    // --- Resource Actions (Upload, Download, Delete) ---
    // onDrop needs to determine resource type *before* calling upload endpoint
    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setUploadError(null);
        setUploadProgress(0); // Start progress tracking
        if (acceptedFiles.length === 0) {
            setUploadProgress(null);
            return;
        };

        let filesProcessed = 0;
        const totalFiles = acceptedFiles.length;

        // Simple heuristic for resource type based on extension
        const getUploadResourceType = (filename: string): ResourceTypeString | null => {
            const ext = filename.split('.').pop()?.toLowerCase();
            if (!ext) return null;
            // Prioritize prompts, then specific types, then general audio/video
            if (filename.toLowerCase().includes('prompt') && ext === 'txt') return 'text_prompt';
            if (ext === 'json') return 'json_transcript'; // Assume transcript for direct upload for now
            if (ext === 'txt') return 'text_session'; // Assume session script for now
            if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
            if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
            return null; // Unknown
        }

        const uploadPromises = acceptedFiles.map(async (file) => {
            const resourceType = getUploadResourceType(file.name);
            if (!resourceType) {
                console.warn(`Skipping upload for ${file.name}: Cannot determine resource type for direct upload.`);
                setUploadError(prev => `${prev ? prev + '\n' : ''}Skipped ${file.name}: Unknown/unsupported type for upload.`);
                filesProcessed++;
                setUploadProgress((filesProcessed / totalFiles) * 100);
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                 console.log(`Uploading ${file.name} as type ${resourceType}...`);
                 await fetchApi(`/upload/${resourceType}`, {
                     method: 'POST',
                     body: formData,
                 });
             } catch (err: any) {
                 console.error(`Failed to upload ${file.name}:`, err);
                  setUploadError(prev => `${prev ? prev + '\n' : ''}Failed to upload ${file.name}: ${err.message}`);
             } finally {
                 filesProcessed++;
                 setUploadProgress((filesProcessed / totalFiles) * 100);
             }
        });

        await Promise.all(uploadPromises);
        fetchResources(); // Refresh list after all uploads attempted
        // Clear progress after a short delay
        setTimeout(() => setUploadProgress(null), 1500);

    }, [fetchResources]);

    // Other handlers (handleUploadClick, handleFileSelected, handleDownloadSelected, handleDeleteSelected, confirmDeletion, cancelDeletion, handleDeleteClick) remain largely the same...
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        noClick: true,
        multiple: true, // Allow multiple files
        onDragEnter: () => {}, // Default empty handler
        onDragOver: () => {}, // Default empty handler
        onDragLeave: () => {}, // Default empty handler
    });

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

     const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
         if (event.target.files) {
             onDrop(Array.from(event.target.files));
         }
         event.target.value = '';
     };

      const handleDownloadSelected = () => {
          if (selectedResources.length === 0) return;
          selectedResources.forEach(resource => {
              // Use resource.id for the download URL
              const link = document.createElement('a');
              link.href = `${API_BASE_URL}/download/${resource.type}/${resource.id}`;
              // Use resource.original_name for the downloaded filename
              link.download = resource.original_name || resource.filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
          });
          setSelectedResourceIds(new Set());
      };

     const handleDeleteSelected = () => {
         if (selectedResources.length === 0) return;
         setShowDeleteConfirmModal(true);
         setResourceToDelete(null);
     };

      const confirmDeletion = async () => {
         const idsToDelete = resourceToDelete ? [resourceToDelete.id] : Array.from(selectedResourceIds);
         const resourcesToDelete = resourceToDelete ? [resourceToDelete] : selectedResources;

         if (idsToDelete.length === 0) return;

         setError(null);
         let deleteErrors = "";

         const deletePromises = resourcesToDelete.map(res =>
             // Use res.id (UUID) for deletion
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
          e.stopPropagation();
          setResourceToDelete(resource);
          setShowDeleteConfirmModal(true);
      }

    // --- Pipeline Processing ---
    const processJob = useCallback(async (job: ProcessingJob) => {
        // Clear previous error for this step
        setStepErrors(prev => ({ ...prev, [job.stepId]: null }));
        setCurrentlyProcessing(job);

        const step = PIPELINE_STEPS.find(s => s.id === job.stepId);
        if (!step) {
            const errorMsg = `Internal error: Invalid step ID ${job.stepId}`;
            console.error("Invalid step ID in job:", job.stepId);
            setError(errorMsg); // Use general error for this internal issue
            setCurrentlyProcessing(null);
            return;
        }

        const formData = new FormData();
        const keyRequirements = step.requiresKeys || [];
        const jobKeys = apiKeys; // Use current API keys state

        // Add required API keys
        for (const keyName of keyRequirements) {
            const apiKey = keyName === 'assemblyAi' ? jobKeys.assemblyAi : jobKeys.googleGemini;
            if (!apiKey) {
                const errorMsg = `API Key "${keyName}" is required for step "${step.name}" but not provided.`;
                setStepErrors(prev => ({ ...prev, [job.stepId]: errorMsg }));
                setCurrentlyProcessing(null);
                setProcessingQueue([]); // Clear queue
                return;
            }
            // Use snake_case key name expected by backend
            const backendKeyName = keyName === 'assemblyAi' ? 'assemblyai_api_key' : 'google_gemini_api_key';
            formData.append(backendKeyName, apiKey);
        }

        // Add input resource IDs using defined field names or type as fallback
        const inputResources = resources.filter(r => job.inputResourceIds.includes(r.id));
        let missingInput = false;
        step.inputs.forEach(inputType => {
             const resource = inputResources.find(r => r.type === inputType);
             if (resource) {
                 // Use defined field name or fallback to `${inputType}_id`
                 const fieldName = step.inputFieldNames?.[inputType] || `${inputType}_id`;
                 formData.append(fieldName, resource.id); // Use UUID (resource.id)
             } else {
                  const errorMsg = `Internal error: Missing required input of type '${inputType}' for step "${step.name}".`;
                  setStepErrors(prev => ({...prev, [job.stepId]: errorMsg }));
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
             console.log("FormData being sent:", Object.fromEntries(formData.entries())); // Log FormData

             const result = await fetchApi<Resource | { [key: string]: Resource }>(step.endpoint, {
                 method: 'POST',
                 body: formData,
             });

             await fetchResources(); // Refresh resources list

             // Handle result (snippets or single resource)
             let newResourceIds: string[] = [];
             if (step.id === 'transcript_to_snippets' && typeof result === 'object' && result !== null) {
                 const generatedSnippets = Object.values(result as { [key: string]: Resource });
                  if (generatedSnippets.length > 0) {
                      setSnippetsForMapping(generatedSnippets);
                      setShowSpeakerMapForm(true);
                      newResourceIds = generatedSnippets.map(s => s.id);
                 } else {
                     // Show error specific to this step
                      setStepErrors(prev => ({ ...prev, [job.stepId]: "Snippet generation finished but returned no snippets."}));
                 }
             } else if (result && typeof result === 'object' && 'id' in result) {
                 const newResource = result as Resource;
                 newResourceIds = [newResource.id];
            } else {
                 console.log(`Step ${step.id} completed, no specific resource returned in response.`);
                 // Might still need to refresh or check status differently
            }

            // Select newly created resources
             if (newResourceIds.length > 0) {
                 setSelectedResourceIds(prev => new Set([...Array.from(prev), ...newResourceIds]));
             }

        } catch (err: any) {
             console.error(`Error processing job ${job.stepId} for resources ${job.inputResourceIds.join(', ')}:`, err);
             // Display error message associated with the specific step
              setStepErrors(prev => ({ ...prev, [job.stepId]: `Step "${step.name}" failed: ${err.message}`}));
             setProcessingQueue([]); // Stop queue on error
        } finally {
             setCurrentlyProcessing(null);
        }

    }, [apiKeys, fetchResources, resources]); // Include resources

    // useEffect to run the queue remains the same
     useEffect(() => {
         if (!currentlyProcessing && processingQueue.length > 0) {
             const nextJob = processingQueue[0];
             setProcessingQueue(prev => prev.slice(1));
             processJob(nextJob);
         }
     }, [currentlyProcessing, processingQueue, processJob]);


    // handleStartProcessing needs to log state *before* queuing
    const handleStartProcessing = (step: PipelineStep) => {
        // ... (keep the initial error clearing and logging) ...
        setError(null);
        setStepErrors(prev => ({ ...prev, [step.id]: null })); // Use step.id
        console.log(`Attempting to start step: ${step.id}`);
        console.log("Current selectedResourceIds:", selectedResourceIds);
        console.log("Current apiKeys:", apiKeys);
    
        const newJobs: ProcessingJob[] = [];
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
    
        if (step.multiInput && step.inputs.length > 0) {
            // --- Pairing Logic (Heuristic) ---
            const groups: { [baseName: string]: { [type in ResourceTypeString]?: Resource } } = {};
            currentSelectedResources.forEach(res => {
                // Use the robust comparison base name for grouping heuristic
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
                        inputOriginalNames: Object.fromEntries(inputIds.map(id => [id, resources.find(r=>r.id===id)?.original_name || '']))
                    });
                }
            });
    
            // --- Fallback / Adjustment ---
            // If heuristic found no pairs, BUT exactly one of each required input type IS selected, allow processing that single pair.
            if (newJobs.length === 0) {
                const requiredInputsSelected = step.inputs.map(inputType =>
                    currentSelectedResources.filter(r => r.type === inputType)
                );
                // Check if exactly one of each is selected
                const exactlyOneOfEachSelected = requiredInputsSelected.every(list => list.length === 1);
    
                if (exactlyOneOfEachSelected) {
                    console.log(`Pairing heuristic failed for step ${step.id}, but exactly one of each input type selected. Proceeding with selected pair.`);
                    const inputIds = requiredInputsSelected.map(list => list[0].id);
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: inputIds,
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: Object.fromEntries(inputIds.map(id => [id, resources.find(r=>r.id===id)?.original_name || '']))
                    });
                }
                // REMOVE THE BLOCKER: Do NOT set an error or return just because the heuristic failed.
                // The error about incorrect *selection* (handled later) is still valid.
                // else { // Only error if the SELECTION itself is wrong, not if pairing failed
                //     const errorMsg = `Could not automatically pair resources for step "<span class="math-inline">\{step\.name\}"\. Ensure required inputs \(</span>{step.inputs.join(', ')}) share a common base filename OR select exactly one of each required input.`;
                //     setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
                //     // return; // REMOVE THIS BLOCKER
                // }
            }
    
        } else if (step.inputs.length === 1) {
            // ... (single input logic remains the same) ...
            currentSelectedResources
                .filter(r => r.type === step.inputs[0])
                .forEach(resource => {
                    newJobs.push({
                        stepId: step.id,
                        inputResourceIds: [resource.id],
                        apiKeys: step.requiresKeys ? apiKeys : undefined,
                        inputOriginalNames: {[resource.id]: resource.original_name}
                    });
                });
        }
    
        // --- Final Check and Queueing ---
        if (newJobs.length > 0) {
            setProcessingQueue(prev => [...prev, ...newJobs]);
        } else {
            // If still no jobs created, it means the *selection* was invalid (not enough items, wrong types)
            const errorMsg = `Invalid selection for step "${step.name}". Select the required input(s): ${step.inputs.join(', ')}.`;
            setStepErrors(prev => ({ ...prev, [step.id]: errorMsg }));
        }
    };

     // handleStopProcessing remains the same
      const handleStopProcessing = () => {
          setProcessingQueue([]);
          if (currentlyProcessing) {
              console.log("Processing queue stopped. Current job will finish.");
          }
      };

    // --- Speaker Map Form (Submit needs to create correct filename) ---
     const handleSpeakerNameChange = (label: string, name: string) => {
         setSpeakerMapInput(prev => ({ ...prev, [label]: name }));
     };

    const submitSpeakerMap = async () => {
         if (Object.keys(speakerMapInput).length === 0) {
              setStepErrors(prev => ({...prev, 'transcript_to_snippets': "Please enter names for the speakers."})); // Show error near relevant step
             return;
         }
          setStepErrors(prev => ({...prev, 'transcript_to_snippets': null})); // Clear error

         try {
             const mapJsonString = JSON.stringify(speakerMapInput, null, 2); // Pretty print JSON
             const blob = new Blob([mapJsonString], { type: 'application/json' });

             // Derive filename from the input audio/transcript base name used for snippets
              let baseName = "session"; // Default fallback
              if (snippetsForMapping.length > 0) {
                   // Try to get base name from the first snippet's original_name
                   baseName = snippetsForMapping[0].original_name
                       .replace(/_speaker_[A-Z]_snippet\.mp3$/i, '');
              }
              const filename = `${baseName}_speaker_map.json`; // Construct logical name

             const formData = new FormData();
             formData.append('file', blob, filename); // Use the logical filename

              console.log(`Uploading speaker map as ${filename}...`);
              const uploadedMapResource = await fetchApi<Resource>('/upload/json_speaker_map', {
                 method: 'POST',
                 body: formData,
             });

             if (uploadedMapResource) {
                 await fetchResources(); // Use await here
                 setShowSpeakerMapForm(false);
                 setSnippetsForMapping([]);
                 setSpeakerMapInput({});
                 // Select the new map resource
                  setSelectedResourceIds(prev => new Set([...Array.from(prev), uploadedMapResource.id]));
             } else {
                  throw new Error("Speaker map upload endpoint did not return resource details.");
             }
         } catch (err: any) {
             console.error("Failed to submit speaker map:", err);
              setStepErrors(prev => ({...prev, 'transcript_to_snippets': `Failed to save speaker map: ${err.message}`}));
         }
     };

    // --- Eligibility & Validation ---
    // checkStepEligibility remains the same
    const checkStepEligibility = (step: PipelineStep): boolean => {
         const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
         if (currentSelectedResources.length === 0) return false;

         if (step.multiInput) {
              // Check if *at least one* resource of *each* required type is selected
              return step.inputs.every(inputType =>
                  currentSelectedResources.some(r => r.type === inputType)
              );
         } else if (step.inputs.length === 1) {
              // Check if *at least one* resource of the required type is selected
              return currentSelectedResources.some(r => r.type === step.inputs[0]);
         }
         return false;
    };

    // getFilenameMismatchWarning adjusted for clarity
    const getFilenameMismatchWarning = (step: PipelineStep): string | null => {
        // ... (keep the initial checks for multiInput and required types) ...
        if (!step.multiInput || !step.inputs.includes('audio') || !step.inputs.includes('json_transcript')) {
            return null;
        }
        const currentSelectedResources = resources.filter(r => selectedResourceIds.has(r.id));
        const selectedAudios = currentSelectedResources.filter(r => r.type === 'audio');
        const selectedTranscripts = currentSelectedResources.filter(r => r.type === 'json_transcript');
    
        // Only show warning if exactly one of each is selected for simplicity
        if (selectedAudios.length === 1 && selectedTranscripts.length === 1) {
            const audioBase = getBaseNameForComparison(selectedAudios[0].original_name);
            const transcriptBase = getBaseNameForComparison(selectedTranscripts[0].original_name);
    
            if (audioBase !== transcriptBase) {
              return `Warning: Selected audio (${selectedAudios[0].original_name}) and transcript (${selectedTranscripts[0].original_name}) may not match (based on names).`;
            }
        }
        return null;
    };

    // --- Rendering ---
    // renderPreview adjusted for dark theme and showing UUID
    const renderPreview = (resource: Resource) => {
         const content = previewContent[resource.id];
         const isLoading = isLoadingPreview.has(resource.id);

         return (
             // Use resource.id as key
             <div key={resource.id} className="mb-4 p-3 border dark:border-gray-700 rounded bg-white dark:bg-gray-800 shadow-sm">
                 {/* Display user-facing original_name */}
                 <h4 className="font-semibold text-sm mb-1 truncate text-gray-800 dark:text-gray-100" title={resource.original_name}>
                     {resource.original_name}
                 </h4>
                 {/* Show type and UUID */}
                 <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center space-x-2">
                     <span>Type: {resource.type}</span>
                     <span className='flex items-center' title="Internal Resource ID">
                        <span className='mr-0.5'><FiInfo size={10} /></span> ID: <code className='ml-1 text-xxs'>{resource.id.substring(0,8)}...</code>
                     </span>
                 </div>
                 {isLoading && <div className="text-center p-4 text-gray-500 dark:text-gray-400"><span className="animate-spin inline-block mr-2"><FiLoader /></span>Loading Preview...</div>}
                 {!isLoading && content && (
                     <>
                         {content.type === 'text' && <pre className="text-xs whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded max-h-60 overflow-y-auto">{content.data}</pre>}
                         {content.type === 'json' && <pre className="text-xs whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded max-h-60 overflow-y-auto">{tryFormatJson(content.data)}</pre>}
                         {/* Use resource.id for audio src URL */}
                         {content.type === 'audio' && content.data && <audio controls src={content.data} className="w-full h-10"></audio>}
                         {content.type === 'video_placeholder' && <div className="text-center p-4 text-gray-400 dark:text-gray-500 text-sm">Video Preview Not Available</div>}
                         {content.type === 'unsupported' && <div className="text-center p-4 text-red-600 dark:text-red-400 text-sm">{content.error || 'Preview not available'}</div>}
                     </>
                 )}
                {!isLoading && !content && <div className="text-center p-4 text-gray-400 dark:text-gray-500 text-sm">Select resource to load preview.</div> }
             </div>
         );
     };

    // tryFormatJson remains the same
    const tryFormatJson = (jsonString: string | null): string => {
        if (!jsonString) return '';
        try {
            return JSON.stringify(JSON.parse(jsonString), null, 2);
        } catch {
            return jsonString;
        }
    };

    // --- Main JSX Structure (with dark theme classes) ---
    return (
        // Main container with dark theme base
        <div className="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            {/* --- Resources Panel (Left) --- */}
            <div className="w-1/4 md:w-1/5 lg:w-1/4 p-4 border-r dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden">
                <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">Resources</h2>
                {/* Buttons with dark styles */}
                <div className="flex space-x-2 mb-3">
                     <button
                        onClick={handleUploadClick}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm inline-flex items-center justify-center transition-colors duration-150"
                        title="Upload Files" >
                        <span className="mr-1"><FiUploadCloud /></span> Upload
                    </button>
                     <input type="file" multiple ref={fileInputRef} onChange={handleFileSelected} className="hidden" accept=".mp4,.mov,.avi,.mkv,.webm,.mp3,.wav,.ogg,.m4a,.flac,.json,.txt"/>
                    <button
                        onClick={handleDownloadSelected}
                        disabled={selectedResources.length === 0}
                        className="flex-1 bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors duration-150"
                        title="Download Selected" >
                        <span className="mr-1"><FiDownload /></span> Download
                    </button>
                    <button
                        onClick={handleDeleteSelected}
                        disabled={selectedResources.length === 0}
                         className="flex-1 bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors duration-150"
                         title="Delete Selected" >
                         <span className="mr-1"><FiTrash2 /></span> Delete
                    </button>
                </div>

                 {/* Dropzone Area with dark styles */}
                 <div
                    {...getRootProps()}
                     className={`flex-grow overflow-y-auto border-2 border-dashed rounded p-2 transition-colors duration-150 ${isDragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'}`}
                 >
                    <input {...getInputProps()} type="file" />
                     {isLoadingResources && <div className="text-center p-4 text-gray-500 dark:text-gray-400">Loading...</div>}
                     {/* Messages with dark styles */}
                     {!isLoadingResources && resources.length === 0 && !isDragActive && (
                         <p className="text-center text-gray-400 dark:text-gray-500 p-4">No resources found. Drag & drop files here or use the Upload button.</p>
                     )}
                      {!isLoadingResources && isDragActive && (
                          <p className="text-center text-blue-600 dark:text-blue-400 p-4 font-semibold">Drop files here...</p>
                      )}
                     {/* Resource List Items with dark styles */}
                     {!isLoadingResources && resources.length > 0 && (
                         <ul className="space-y-1">
                             {resources.map(res => (
                                 <li
                                     key={res.id} // Use UUID as key
                                     onClick={() => toggleResourceSelection(res.id)}
                                     className={`p-2 text-sm rounded cursor-pointer flex justify-between items-center group transition-colors duration-100 ${
                                         selectedResourceIds.has(res.id)
                                         ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 ring-1 ring-blue-400 dark:ring-blue-600'
                                         : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                     }`}
                                 >
                                      {/* Display user-facing original_name */}
                                     <span className="truncate flex-grow mr-2" title={res.original_name}>
                                         {res.original_name}
                                     </span>
                                     <span className="text-xs text-gray-500 dark:text-gray-400 mr-2 flex-shrink-0">{res.type}</span>
                                     <button
                                         onClick={(e) => handleDeleteClick(e, res)}
                                         className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1"
                                         title="Delete this resource"
                                      >
                                         <FiTrash2 size={14}/>
                                     </button>
                                 </li>
                             ))}
                         </ul>
                     )}
                </div>
                 {/* Upload Progress/Error with dark styles */}
                 {uploadProgress !== null && <div className="mt-2 text-xs text-center text-blue-600 dark:text-blue-400">Uploading... {Math.round(uploadProgress)}%</div>}
                 {uploadError && <div className="mt-2 p-2 text-xs text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 rounded whitespace-pre-wrap">{uploadError}</div>}
            </div>

             {/* --- Preview Panel (Middle) --- */}
             <div className="w-1/4 md:w-2/5 lg:w-1/3 p-4 border-r dark:border-gray-700 dark:bg-gray-850 overflow-y-auto"> {/* Slightly darker bg */}
                 <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">Preview</h2>
                  {selectedResources.length === 0 && <p className="text-center text-gray-400 dark:text-gray-500 mt-10">Select a resource to preview</p>}
                 {/* renderPreview handles its own dark styles */}
                 {selectedResources.map(renderPreview)}
            </div>


            {/* --- Pipeline Panel (Right) --- */}
            <div className="flex-grow p-4 flex flex-col items-center overflow-y-auto bg-gray-100 dark:bg-gray-900">
                <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">WAZAAAAAAP</h2>

                {/* Global Error Display with dark styles */}
                {error && <div className="w-full max-w-3xl mb-4 p-3 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-200 rounded border border-red-300 dark:border-red-700 text-sm">{error}</div>}


                {/* API Key Inputs with dark styles */}
                 <div className="w-full max-w-3xl mb-6 p-4 border dark:border-gray-700 rounded bg-white dark:bg-gray-800 shadow-sm">
                    <h3 className="text-lg font-medium mb-3 text-gray-800 dark:text-gray-100">API Keys <span className='text-xs text-gray-500 dark:text-gray-400'>(Required for some steps)</span></h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                              <label htmlFor="assemblyai-key" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">AssemblyAI Key</label>
                             <input
                                 type="password"
                                 id="assemblyai-key"
                                 placeholder="Enter AssemblyAI API Key"
                                 value={apiKeys.assemblyAi || ''}
                                 onChange={(e) => setApiKeys(prev => ({ ...prev, assemblyAi: e.target.value }))}
                                  className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-500 dark:focus:border-blue-500"
                             />
                         </div>
                         <div>
                               <label htmlFor="gemini-key" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Google Gemini Key</label>
                             <input
                                 type="password"
                                 id="gemini-key"
                                 placeholder="Enter Google Gemini API Key"
                                 value={apiKeys.googleGemini || ''}
                                 onChange={(e) => setApiKeys(prev => ({ ...prev, googleGemini: e.target.value }))}
                                 className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-500 dark:focus:border-blue-500"
                             />
                         </div>
                     </div>
                 </div>

                {/* Stop Button with dark styles */}
                {(currentlyProcessing || processingQueue.length > 0) && (
                    <button
                        onClick={handleStopProcessing}
                          className="mb-4 bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white px-4 py-1.5 rounded text-sm inline-flex items-center justify-center transition-colors duration-150" >
                        <span className="mr-1"><FiStopCircle/></span> Stop Queue ({processingQueue.length} pending)
                    </button>
                 )}

                {/* Pipeline Steps with dark styles */}
                <div className="w-full max-w-3xl space-y-4">
                     {PIPELINE_STEPS.map(step => {
                         const isEligible = checkStepEligibility(step);
                         const jobIsActive = currentlyProcessing?.stepId === step.id;
                         const jobIsInQueue = processingQueue.some(j => j.stepId === step.id);
                         const isProcessingThisStep = jobIsActive || jobIsInQueue;
                         const mismatchWarning = getFilenameMismatchWarning(step);
                         const stepError = stepErrors[step.id];

                         return (
                              <div key={step.id} className={`p-4 border dark:border-gray-700 rounded bg-white dark:bg-gray-800 shadow-sm transition-all duration-150 ${isEligible ? 'border-blue-300 dark:border-blue-700' : 'border-gray-200 dark:border-gray-700'}`}>
                                  <h3 className="text-lg font-medium mb-1 text-gray-800 dark:text-gray-100">{step.name}</h3>
                                 <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                     Input: {step.inputs.join(', ')} &rarr; Output: {step.output}
                                      {step.requiresKeys && ` (Requires: ${step.requiresKeys.join(', ')})`}
                                 </p>
                                 {/* Warnings and Errors with dark styles */}
                                 {mismatchWarning && isEligible && !stepError && (
                                     <p className="text-xs text-yellow-800 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-900/50 p-1.5 rounded mb-2 inline-flex items-center border border-yellow-300 dark:border-yellow-700">
                                         <span className="mr-1 flex-shrink-0"><FiAlertTriangle  /></span>{mismatchWarning}
                                     </p>
                                 )}
                                 {stepError && (
                                     <p className="text-xs text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/50 p-1.5 rounded mb-2 inline-flex items-center border border-red-300 dark:border-red-700">
                                          <span className="mr-1 flex-shrink-0"><FiAlertTriangle /></span> {stepError}
                                      </p>
                                 )}
                                  {/* Start Button with dark styles */}
                                 <button
                                     onClick={() => handleStartProcessing(step)}
                                     disabled={!isEligible || isProcessingThisStep}
                                      className={`w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors duration-150 ${isProcessingThisStep ? 'bg-gray-400 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-600 cursor-wait' : ''}`} >
                                     {jobIsActive ? (
                                         <> <span className="animate-spin mr-2"><FiLoader  /></span> Processing... </>
                                     ) : jobIsInQueue ? (
                                          <> <span className="animate-spin mr-2"><FiLoader  /></span> Queued... </>
                                     ) : (
                                         'Start Step'
                                     )}
                                 </button>
                             </div>
                         );
                    })}
                </div>

                {/* Speaker Map Form Modal with dark styles */}
                 {showSpeakerMapForm && (
                     <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-40">
                          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                             <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Identify Speakers</h2>
                              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Listen to the snippets and enter the name for each speaker label.</p>
                             {/* Display step error here too */}
                              {stepErrors['transcript_to_snippets'] && (
                                   <p className="text-xs text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/50 p-1.5 rounded mb-3 inline-flex items-center border border-red-300 dark:border-red-700">
                                       <span className="mr-1 flex-shrink-0"><FiAlertTriangle  /></span> {stepErrors['transcript_to_snippets']}
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
                                              {/* Use UUID for audio source */}
                                               <audio controls src={`${API_BASE_URL}/download/snippet/${snippet.id}`} className="h-8"></audio>
                                          </div>
                                      );
                                  })}
                             </div>
                             <div className="mt-6 flex justify-end space-x-3">
                                 <button
                                      onClick={() => setShowSpeakerMapForm(false)}
                                       className="bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-black dark:text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" >
                                      Cancel
                                  </button>
                                  <button
                                      onClick={submitSpeakerMap}
                                       className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" >
                                      Save Speaker Map
                                  </button>
                              </div>
                          </div>
                     </div>
                  )}


                 {/* Delete Confirmation Modal with dark styles */}
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
                                  <button
                                      onClick={cancelDeletion}
                                       className="bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-black dark:text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" >
                                      Cancel
                                  </button>
                                  <button
                                      onClick={confirmDeletion}
                                       className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-4 py-1.5 rounded text-sm transition-colors duration-150" >
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