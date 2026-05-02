import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

export async function presignPut(key: string, contentType: string) {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(getClient(), cmd, { expiresIn: 600 });
  return url;
}
