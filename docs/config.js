window.DASHBOARD_CONFIG = {
  endpoints: {
    siteData: "./data/site-data.json"
  },
  refreshEnabled: false,
  pollMs: 0
};
window.FLIGHT_TRACKER_CONFIG = {
  sourceMode: "direct",
  endpoint: null,
  snapshotEndpoint: "./data/live-aircraft.json",
  directUrl: "https://opensky-network.org/api/states/all",
  defaultPreset: "world",
  pollMs: 20000,
  includeOnGround: false
};
