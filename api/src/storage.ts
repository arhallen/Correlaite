import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from './config.js';
import { HttpError } from './errors.js';

let containerPromise: Promise<ContainerClient> | null = null;

function getContainer(): Promise<ContainerClient> {
  containerPromise ??= (async () => {
    let svc: BlobServiceClient;
    if (config.STORAGE_CONNECTION_STRING) {
      svc = BlobServiceClient.fromConnectionString(config.STORAGE_CONNECTION_STRING);
    } else if (config.STORAGE_ACCOUNT_URL) {
      svc = new BlobServiceClient(config.STORAGE_ACCOUNT_URL, new DefaultAzureCredential());
    } else {
      throw new HttpError(503, 'Storage is not configured');
    }
    const c = svc.getContainerClient(config.STORAGE_CONTAINER);
    await c.createIfNotExists();
    return c;
  })().catch((e) => {
    containerPromise = null;
    throw e;
  });
  return containerPromise;
}

export async function putBlob(path: string, data: Buffer) {
  const c = await getContainer();
  await c.getBlockBlobClient(path).uploadData(data);
}

export async function getBlob(path: string): Promise<Buffer> {
  const c = await getContainer();
  return c.getBlockBlobClient(path).downloadToBuffer();
}

export async function deleteBlob(path: string) {
  const c = await getContainer();
  await c.getBlockBlobClient(path).deleteIfExists();
}
