// src/components/PipelinePanel.tsx
import { FiStopCircle, FiLoader, FiAlertTriangle } from 'react-icons/fi';
import { PipelineStep, ProcessingJob } from '../types';

interface PipelinePanelProps {
    error: string | null;
    apiKeys: { assemblyAi?: string; googleGemini?: string };
    onApiKeyChange: (keyName: 'assemblyAi' | 'googleGemini', value: string) => void;
    currentlyProcessing: ProcessingJob | null;
    processingQueue: ProcessingJob[];
    onStopProcessing: () => void;
    pipelineSteps: PipelineStep[]; // Pass the definition array
    stepErrors: { [stepId: string]: string | null };
    onStartProcessing: (step: PipelineStep) => void;
    checkStepEligibility: (step: PipelineStep) => boolean;
    getFilenameMismatchWarning: (step: PipelineStep) => string | null;
}

export function PipelinePanel({
    error,
    apiKeys,
    onApiKeyChange,
    currentlyProcessing,
    processingQueue,
    onStopProcessing,
    pipelineSteps,
    stepErrors,
    onStartProcessing,
    checkStepEligibility,
    getFilenameMismatchWarning
}: PipelinePanelProps) {
    return (
        <div className="flex-grow p-4 flex flex-col items-center overflow-y-auto bg-gray-100 dark:bg-gray-900">
            <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">Processing Pipeline</h2>

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
                            onChange={(e) => onApiKeyChange('assemblyAi', e.target.value)}
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
                            onChange={(e) => onApiKeyChange('googleGemini', e.target.value)}
                            className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-500 dark:focus:border-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* Stop Button with dark styles */}
            {(currentlyProcessing || processingQueue.length > 0) && (
                <button
                    onClick={onStopProcessing}
                    className="mb-4 bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white px-4 py-1.5 rounded text-sm inline-flex items-center justify-center transition-colors duration-150" >
                    <span className="mr-1"><FiStopCircle /></span> Stop Queue ({processingQueue.length} pending)
                </button>
            )}

            {/* Pipeline Steps with dark styles */}
            <div className="w-full max-w-3xl space-y-4">
                {pipelineSteps.map(step => {
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
                                    <span className="mr-1 flex-shrink-0"><FiAlertTriangle /></span>{mismatchWarning}
                                </p>
                            )}
                            {stepError && (
                                <p className="text-xs text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/50 p-1.5 rounded mb-2 inline-flex items-center border border-red-300 dark:border-red-700">
                                    <span className="mr-1 flex-shrink-0"><FiAlertTriangle /></span> {stepError}
                                </p>
                            )}
                            {/* Start Button with dark styles */}
                            <button
                                onClick={() => onStartProcessing(step)}
                                disabled={!isEligible || isProcessingThisStep}
                                className={`w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors duration-150 ${isProcessingThisStep ? 'bg-gray-400 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-600 cursor-wait' : ''}`} >
                                {jobIsActive ? (
                                    <> <span className="animate-spin mr-2"><FiLoader /></span> Processing... </>
                                ) : jobIsInQueue ? (
                                    <> <span className="animate-spin mr-2"><FiLoader /></span> Queued... </>
                                ) : (
                                    'Start Step'
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}