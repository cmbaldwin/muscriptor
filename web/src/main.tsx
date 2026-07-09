import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

// No <StrictMode>: the app is built around Tone's single global transport /
// AudioContext (see useAudioEngine), and StrictMode's simulated double-mount
// would create a second engine and double-trigger audio in dev.
createRoot(document.getElementById("root")!).render(<App />);
