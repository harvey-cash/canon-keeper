// src/App.tsx
import { useState, ChangeEvent, FormEvent } from 'react';

// Define the expected structure of the successful API response
interface ApiResult {
  message: string;
  video_name: string;
  session_script: string;
  recap: string;
  summary: string;
}

// Define the structure for potential API error responses
interface ApiError {
  detail: string;
}

const API_URL = 'http://localhost:8000/process-video/'; // Your FastAPI backend URL

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [transcriptApiKey, setTranscriptApiKey] = useState<string>('');
  const [llmApiKey, setLlmApiKey] = useState<string>('');
  const [recapPrompt, setRecapPrompt] = useState<string>('');
  const [summaryPrompt, setSummaryPrompt] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setVideoFile(event.target.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!videoFile || !transcriptApiKey || !llmApiKey || !recapPrompt || !summaryPrompt) {
      setError('Please fill in all fields and select a video file.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('video', videoFile);
    formData.append('transcript_api_key', transcriptApiKey);
    formData.append('llm_api_key', llmApiKey);
    formData.append('recap_prompt', recapPrompt);
    formData.append('summary_prompt', summaryPrompt);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
        headers: {
            'Accept': 'application/json',
        },
      });

      const responseData = await response.json();

      if (!response.ok) {
        const errorMsg = (responseData as ApiError)?.detail || `HTTP error! status: ${response.status}`;
        console.error('API Error Response:', responseData);
        throw new Error(errorMsg);
      }

      setResult(responseData as ApiResult);

    } catch (err) {
      console.error('Error submitting form:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  // Determine text color based on system preference for elements not explicitly styled
  // This helps ensure readability if Tailwind defaults aren't sufficient
  // You could also force light/dark mode with Tailwind classes if preferred
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const defaultTextColor = prefersDark ? 'text-gray-100' : 'text-gray-900';

  return (
    // The container inherits the background from index.css (dark/light mode)
    <div className={`container mx-auto p-4 max-w-3xl ${defaultTextColor}`}>
      <h1 className="text-3xl font-bold mb-6 text-center text-white">
        Canon Keeper
      </h1>
      <h2 className="text-3xl font-bold mb-6 text-center text-white">Video Recap Generator</h2>

      {/* Form has a white background */}
      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow-md">
        {/* Video File Input Label - ensure label text is dark on white form bg */}
        <div>
          <label htmlFor="videoFile" className="block text-sm font-medium text-gray-700 mb-1">
            Video File (.mp4, .mov, etc.)
          </label>
          <input
            id="videoFile"
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            required
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
           {videoFile && <p className="text-xs text-gray-500 mt-1">Selected: {videoFile.name}</p>}
        </div>

        {/* API Keys - ensure label text is dark, input text is dark */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="transcriptApiKey" className="block text-sm font-medium text-gray-700 mb-1">
              AssemblyAI API Key
            </label>
            <input
              id="transcriptApiKey"
              type="password"
              value={transcriptApiKey}
              onChange={(e) => setTranscriptApiKey(e.target.value)}
              required
              placeholder="Your AssemblyAI Key"
              // Added text-gray-900 for input text color
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900"
            />
          </div>
          <div>
            <label htmlFor="llmApiKey" className="block text-sm font-medium text-gray-700 mb-1">
              Google Gemini API Key
            </label>
            <input
              id="llmApiKey"
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              required
              placeholder="Your Gemini Key"
               // Added text-gray-900 for input text color
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900"
            />
          </div>
        </div>

        {/* Prompts - ensure label text is dark, textarea text is dark */}
        <div>
          <label htmlFor="recapPrompt" className="block text-sm font-medium text-gray-700 mb-1">
            Recap Prompt
          </label>
          <textarea
            id="recapPrompt"
            rows={3}
            value={recapPrompt}
            onChange={(e) => setRecapPrompt(e.target.value)}
            required
            placeholder="Enter the prompt for generating the detailed recap..."
             // Added text-gray-900 for textarea text color
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900"
          />
        </div>
        <div>
          <label htmlFor="summaryPrompt" className="block text-sm font-medium text-gray-700 mb-1">
            Summary Prompt
          </label>
          <textarea
            id="summaryPrompt"
            rows={3}
            value={summaryPrompt}
            onChange={(e) => setSummaryPrompt(e.target.value)}
            required
            placeholder="Enter the prompt for generating the concise summary..."
            // Added text-gray-900 for textarea text color
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900"
          />
        </div>

        {/* Submit Button */}
        <div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Generate Recap & Summary'}
          </button>
        </div>
      </form>

      {/* Loading Indicator - Ensure text color contrasts with page background */}
      {isLoading && (
        <div className={`mt-6 text-center ${prefersDark ? 'text-blue-400' : 'text-blue-600'}`}>
          Processing video, please wait... This might take a while.
        </div>
      )}

      {/* Error Display - Tailwind colors usually handle this well, but check contrast */}
      {error && (
        <div className="mt-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
          <p><span className="font-bold">Error:</span> {error}</p>
        </div>
      )}

      {/* Results Display - Ensure text contrasts with page background */}
      {result && !isLoading && (
        <div className="mt-8 space-y-6">
          {/* Use defaultTextColor for the heading */}
          <h2 className={`text-2xl font-semibold ${defaultTextColor}`}>Results for: {result.video_name}</h2>

          {/* Result Boxes (light background, dark text needed) */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-xl font-medium text-gray-700 mb-2">Recap</h3>
            {/* Ensure pre text is dark */}
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">{result.recap}</pre>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-xl font-medium text-gray-700 mb-2">Summary</h3>
             {/* Ensure pre text is dark */}
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">{result.summary}</pre>
          </div>

           <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-xl font-medium text-gray-700 mb-2">Session Script (Transcript)</h3>
             {/* Ensure pre text is dark */}
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">{result.session_script}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;