import { ApplicationInsights, DistributedTracingModes } from '@microsoft/applicationinsights-web';

// Set at build time from the deployed Application Insights resource; not configured locally, so nothing is sent in dev.
const connectionString = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_APPINSIGHTS_CONNECTION_STRING;

/** Page views (including client-side route changes), page visit time, and /api calls made from the browser. */
export function initTelemetry() {
  if (!connectionString) return;
  const ai = new ApplicationInsights({
    config: {
      connectionString,
      enableAutoRouteTracking: true,
      autoTrackPageVisitTime: true,
      distributedTracingMode: DistributedTracingModes.W3C, // links browser calls to the API's requests
      disableFetchTracking: false,
    },
  });
  ai.loadAppInsights();
  ai.addTelemetryInitializer((item) => {
    item.tags = item.tags || [];
    item.tags['ai.cloud.role'] = 'correlaite-web';
  });
  ai.trackPageView();
}
