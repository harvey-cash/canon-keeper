// src/components/ResourcesPanel.tsx
import React from 'react';
import { FiUploadCloud, FiDownload, FiTrash2 } from 'react-icons/fi';
import { Resource } from '../types'; // Assuming types are moved to src/types.ts

interface ResourcesPanelProps {
    resources: Resource[];
    selectedResourceIds: Set<string>;
    isLoadingResources: boolean;
    isDragActive: boolean; // Pass drag state down
    uploadProgress: number | null;
    uploadError: string | null;
    onUploadClick: () => void;
    onDownloadSelected: () => void;
    onDeleteSelected: () => void;
    onToggleResourceSelection: (id: string) => void;
    onDeleteClick: (e: React.MouseEvent, resource: Resource) => void;
    getRootProps: <T extends DropzoneOptions>(options?: T | undefined) => DropzoneRootProps; // Pass down dropzone props
    getInputProps: () => DropzoneInputProps;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void;
    acceptFileTypes: string; // Pass accept string
}

// Re-import necessary types from react-dropzone if needed, or use any
import { DropzoneOptions, DropzoneRootProps, DropzoneInputProps } from 'react-dropzone';

export function ResourcesPanel({
    resources,
    selectedResourceIds,
    isLoadingResources,
    isDragActive,
    uploadProgress,
    uploadError,
    onUploadClick,
    onDownloadSelected,
    onDeleteSelected,
    onToggleResourceSelection,
    onDeleteClick,
    getRootProps,
    getInputProps,
    fileInputRef,
    onFileSelected,
    acceptFileTypes
}: ResourcesPanelProps) {
    const selectedResourcesCount = selectedResourceIds.size; // Calculate based on Set size

    return (
        <div className="w-1/4 md:w-1/5 lg:w-1/4 p-4 border-r dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden">
            <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">Resources</h2>
            {/* Buttons with dark styles */}
            <div className="flex space-x-2 mb-3">
                <button
                    onClick={onUploadClick}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm inline-flex items-center justify-center transition-colors duration-150"
                    title="Upload Files" >
                    <span className="mr-1"><FiUploadCloud /></span> Upload
                </button>
                <input type="file" multiple ref={fileInputRef} onChange={onFileSelected} className="hidden" accept={acceptFileTypes} />
                <button
                    onClick={onDownloadSelected}
                    disabled={selectedResourcesCount === 0}
                    className="flex-1 bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors duration-150"
                    title="Download Selected" >
                    <span className="mr-1"><FiDownload /></span> Download
                </button>
                <button
                    onClick={onDeleteSelected}
                    disabled={selectedResourcesCount === 0}
                    className="flex-1 bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors duration-150"
                    title="Delete Selected" >
                    <span className="mr-1"><FiTrash2 /></span> Delete
                </button>
            </div>

            {/* Dropzone Area with dark styles */}
            <div
                {...getRootProps}
                className={`flex-grow overflow-y-auto border-2 border-dashed rounded p-2 transition-colors duration-150 ${isDragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'}`}
            >
                <input {...getInputProps()} /> {/* Input associated with dropzone */}
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
                                onClick={() => onToggleResourceSelection(res.id)}
                                className={`p-2 text-sm rounded cursor-pointer flex justify-between items-center group transition-colors duration-100 ${selectedResourceIds.has(res.id)
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
                                    onClick={(e) => onDeleteClick(e, res)}
                                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1"
                                    title="Delete this resource"
                                >
                                    <FiTrash2 size={14} />
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
    );
}