import { DefaultAzureCredential } from '@azure/identity';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { extractCode } from './util.js';

const cred = new DefaultAzureCredential();

const SYSTEM = `You write Python 3 code that runs in an isolated sandbox WITHOUT internet access.
Rules:
- Output ONLY one fenced python code block, no explanation.
- If the task names a dataset file, use exactly that path (it is in /mnt/data/). Inspect it before using it (columns, dtypes). Supported formats: csv, tsv, json, xlsx, parquet, txt - choose the reader from the file extension.
- If the task says no dataset is attached, do not search the filesystem for data: either generate sample data if the task allows, or print a short message saying no dataset is attached.
- pandas, numpy, matplotlib are available. Do not pip install anything. Do not make network calls.
- Print the results you want the user to see. For charts, save PNG files to /mnt/data/ and print their filenames.`;

export interface Generated {
  code: string;
  tokens: number;
}

export async function generateCode(prompt: string, dataset: { filename: string } | null): Promise<Generated> {
  const { AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_DEPLOYMENT: deployment } = config;
  if (!endpoint || !deployment) throw new HttpError(503, 'AI model is not configured');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.AZURE_OPENAI_API_KEY) headers['api-key'] = config.AZURE_OPENAI_API_KEY;
  else headers.Authorization = `Bearer ${(await cred.getToken('https://cognitiveservices.azure.com/.default')).token}`;

  const user = dataset ? `Dataset file: /mnt/data/${dataset.filename}\n\nTask: ${prompt}` : `No dataset is attached.\n\nTask: ${prompt}`;
  const res = await fetch(
    `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${config.AZURE_OPENAI_API_VERSION}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new HttpError(502, `Model call failed (${res.status})`);
  const json: any = await res.json();
  const content: string = json.choices?.[0]?.message?.content ?? '';
  if (!content) throw new HttpError(502, 'Model returned no code');
  return { code: extractCode(content), tokens: Number(json.usage?.total_tokens ?? 0) };
}
