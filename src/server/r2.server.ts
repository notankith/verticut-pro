import { S3Client, PutObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3: S3Client | null = null;

function getClient() {
  if (s3) return s3;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }
  s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3;
}

export function getBucket() {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET not configured");
  return b;
}

export function publicUrl(key: string) {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) throw new Error("R2_PUBLIC_BASE_URL not configured");
  return `${base.replace(/\/$/, "")}/${key}`;
}

// R2 keys are content-addressed (random UUIDs), so the URL is immutable —
// browsers and CDN can cache for a year without revalidation.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function presignPut(key: string, contentType: string) {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
    CacheControl: IMMUTABLE_CACHE_CONTROL,
  });
  const url = await getSignedUrl(getClient(), cmd, { expiresIn: 600 });
  return url;
}

// Upload a buffer directly to R2 (server-side helper)
export async function uploadBuffer(key: string, buffer: Buffer | Uint8Array, contentType = 'application/octet-stream') {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: IMMUTABLE_CACHE_CONTROL,
  });
  await getClient().send(cmd);
  return publicUrl(key);
}

// Browser WebCodecs (`renderMediaOnWeb` / @remotion/media) fetches media with
// `fetch()`, which requires CORS. Custom-domain R2 (media.ankith.studio) does
// not send ACAO unless a bucket CORS policy is set. Idempotent and cached.
let corsReady: Promise<void> | null = null;

export function ensureR2Cors(): Promise<void> {
  if (!corsReady) {
    corsReady = (async () => {
      try {
        await getClient().send(
          new PutBucketCorsCommand({
            Bucket: getBucket(),
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: ["*"],
                  AllowedMethods: ["GET", "HEAD", "PUT"],
                  AllowedHeaders: ["*"],
                  ExposeHeaders: [
                    "ETag",
                    "Content-Length",
                    "Content-Type",
                    "Content-Range",
                    "Accept-Ranges",
                  ],
                  MaxAgeSeconds: 86400,
                },
              ],
            },
          }),
        );
      } catch (err) {
        console.error("Failed to apply R2 CORS policy:", err);
        corsReady = null;
      }
    })();
  }
  return corsReady;
}
