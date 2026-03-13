import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LiveFlightTracker } from "./LiveFlightTracker.jsx";
import "./tracker.css";

const rootNode = document.getElementById("liveFlightTrackerRoot");

if (rootNode) {
  const config = {
    sourceMode: "backend",
    endpoint: "/api/live-aircraft",
    snapshotEndpoint: null,
    directUrl: "https://opensky-network.org/api/states/all",
    defaultPreset: "world",
    pollMs: 15000,
    includeOnGround: false,
    ...(window.FLIGHT_TRACKER_CONFIG || {}),
  };

  createRoot(rootNode).render(
    <StrictMode>
      <LiveFlightTracker config={config} />
    </StrictMode>,
  );
}
