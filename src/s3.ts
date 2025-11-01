import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './config';

const client = new S3Client({
  region: env.s3.region,
  endpoint: env.s3.endpoint,
  forcePathStyle: env.s3.pathStyle,
  credentials: {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey
  }
});

export interface PresignUploadParams {
  key: string;
  contentType: string;
}

export interface PresignDownloadParams {
  key: string;
}

export async function s3PresignUpload({ key, contentType }: PresignUploadParams) {
  const command = new PutObjectCommand({
    Bucket: env.s3.bucket,
    Key: key,
    ContentType: contentType,
    ACL: 'private'
  });

  const url = await getSignedUrl(client, command, { expiresIn: env.s3.presignTtl });

  return {
    url,
    expires_in: env.s3.presignTtl,
    headers: {
      'Content-Type': contentType
    }
  };
}

export async function s3PresignDownload({ key }: PresignDownloadParams) {
  const command = new GetObjectCommand({
    Bucket: env.s3.bucket,
    Key: key
  });

  const url = await getSignedUrl(client, command, { expiresIn: env.s3.presignTtl });

  return {
    url,
    expires_in: env.s3.presignTtl
  };
}
