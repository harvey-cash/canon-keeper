// src/components/PreviewPanel.tsx
import { JSX } from 'react';
import { Resource } from '../types'; // Assuming types are moved to src/types.ts

interface PreviewPanelProps {
    selectedResources: Resource[];
    renderPreview: (resource: Resource) => JSX.Element; // Pass the render function down
}

export function PreviewPanel({
    selectedResources,
    renderPreview
}: PreviewPanelProps) {
    return (
        <div className="w-1/4 md:w-2/5 lg:w-1/3 p-4 border-r dark:border-gray-700 dark:bg-gray-850 overflow-y-auto"> {/* Slightly darker bg */}
            <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">Preview</h2>
            {selectedResources.length === 0 && <p className="text-center text-gray-400 dark:text-gray-500 mt-10">Select a resource to preview</p>}
            {/* renderPreview handles its own dark styles */}
            {selectedResources.map(renderPreview)}
        </div>
    );
}