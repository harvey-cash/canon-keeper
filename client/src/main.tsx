// client/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

const rootElement = document.getElementById("root");

// Check if the element was actually found
if (!rootElement) {
  // If not found, throw an error - the app can't mount!
  throw new Error(
    "Failed to find the root element with ID 'root'. Check your index.html.",
  );
}

// If we get here, rootElement is guaranteed to be an HTMLElement
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
