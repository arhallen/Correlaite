// Must be the FIRST import of server.ts: OpenTelemetry has to patch node:http before Fastify loads it,
// otherwise incoming API requests are not recorded as Application Insights requests.
import { useAzureMonitor } from '@azure/monitor-opentelemetry';

if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  try {
    useAzureMonitor();
  } catch (e) {
    console.warn('Application Insights not started', e);
  }
}
