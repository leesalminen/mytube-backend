# MyTube Backend Integration Guide (iOS Front End)

This document explains how the Swift client integrates with the MyTube backend, supports user-supplied S3-compatible storage, and optionally upgrades to the managed subscription service.

## 1. Base URL and Authentication

- **Backend base URL**: Provided by your deployment (e.g. `https://api.mytube.example`).
- **Authentication**: All protected endpoints use NIP-98 (Nostr HTTP Auth). The mobile client:
  1. POSTs to `/auth/challenge` to receive a short-lived `challenge`.
  2. Signs the challenge using the user’s Nostr secret (NIP-07 or raw SK).
  3. Sends the signed event in the `Authorization: Nostr <base64>` header on subsequent requests.

### Swift Flow Snippet
```swift
struct ChallengeResponse: Decodable {
    let challenge: String
    let expires_at: Date
}

func fetchChallenge() async throws -> ChallengeResponse {
    let url = apiURL.appending(path: "auth/challenge")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"

    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder.iso8601.decode(ChallengeResponse.self, from: data)
}

func buildNIP98Header(challenge: String, method: String, path: String, signer: NostrSigner) throws -> String {
    let content = "challenge=\(challenge)&method=\(method)&url=\(path)"
    let event = try signer.sign(
        kind: 27235,
        content: content,
        tags: []
    )
    let payload = try JSONEncoder().encode(event)
    return "Nostr \(payload.base64EncodedString())"
}
```

## 2. Environment Variables Required by Backend

Set these for the container or local `.env` file:

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default 8080) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `NODE_ENV` | `production` / `development` |
| `DATABASE_URL` | SQLite (`file:./prisma/dev.db`) or Postgres connection string |
| `S3_REGION` | AWS-style region (e.g. `us-east-1`) |
| `S3_ENDPOINT` | Custom S3 endpoint (e.g. `https://s3.custom.cloud`) |
| `S3_BUCKET` | Target bucket/container |
| `S3_PATH_STYLE` | `true` for path-style URLs (MinIO), `false` for virtual-hosted-style |
| `S3_ACCESS_KEY` | Access key for signing presigned URLs |
| `S3_SECRET_KEY` | Secret key |
| `PRESIGN_TTL_SECONDS` | Presigned URL lifetime (default 600) |
| `NIP98_CHALLENGE_TTL_SECONDS` | Challenge lifetime (default 300) |
| `FREE_TRIAL_MODE` | `true` to auto-grant 30‑day trial entitlements |
| `FREE_TRIAL_DAYS` | Trial duration in days (default 30) |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_BASE64`, `APPLE_ENVIRONMENT` | Required to validate App Store notifications |
| `GOOGLE_PROJECT_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY_BASE64` | Required to validate Google Play notifications |

Note: For a pure BYO-S3 setup without paid subscriptions, the Apple/Google variables can remain unset. Webhook routes will return errors if the credentials are missing; either disable routes at the ingress or provide placeholder values.

## 3. BYO S3 (User-Provided Storage)

### Overview
1. **Collect endpoint info from users**: In-app UI lets users paste their S3-compatible endpoint, bucket, access key, secret key, and region.
2. **Client-side signing**: For fully private setups, the client can sign direct uploads using a local SigV4 implementation (see Section 5). Alternatively, the backend can presign requests using user keys stored server-side.
3. **Backend support**: Current backend presigns using server env vars. To support per-user keys, extend `/presign/upload` to read keys from user profile. The default plan expects shared backend credentials.

### Minimal Swift UI Fields
```swift
struct StorageConfig {
    var endpoint: URL
    var bucket: String
    var region: String
    var accessKey: String
    var secretKey: String
    var pathStyle: Bool
}
```

## 4. Subscription (Managed Service) Flow

1. **Entitlement check**: Call `GET /entitlement` after authenticating. Response sample:
   ```json
   {
     "plan": "pro-monthly",
     "status": "active",
     "expires_at": "2025-01-01T00:00:00.000Z",
     "quota_bytes": "214748364800",
     "used_bytes": "0"
   }
   ```
2. **Client decision**:
   - If `status` is `none` or `expired`, keep user in BYO mode or prompt for upgrade.
   - When `FREE_TRIAL_MODE=true`, the backend will automatically create a `trial` entitlement lasting `FREE_TRIAL_DAYS` for new users with no purchases.
   - If `status` is `active`, user can access paid storage quota and presign endpoints.
3. **Purchase events**:
   - iOS: After successful StoreKit transaction, send the App Account Token and original transaction ID to the backend (custom endpoint you implement) so webhooks can resolve the `npub`.
   - Android: Send purchase token, package name, and subscription ID to backend similarly.

## 5. Client-Side Upload (Swift)

Use the backend presigner or local SigV4 signer. Example when backend presigns:

```swift
struct PresignUploadRequest: Encodable {
    let filename: String
    let content_type: String
    let size_bytes: Int
}

struct PresignUploadResponse: Decodable {
    let key: String
    let url: URL
    let headers: [String: String]
    let expires_in: Int
}

func requestUploadURL(file: URL, mimeType: String, size: Int) async throws -> PresignUploadResponse {
    let authHeader = try await nip98Header(method: "POST", path: "/presign/upload")
    var request = URLRequest(url: apiURL.appending(path: "presign/upload"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(authHeader, forHTTPHeaderField: "Authorization")
    request.httpBody = try JSONEncoder().encode(PresignUploadRequest(
        filename: file.lastPathComponent,
        content_type: mimeType,
        size_bytes: size
    ))

    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(PresignUploadResponse.self, from: data)
}

func uploadToS3(presign: PresignUploadResponse, fileURL: URL) async throws {
    var request = URLRequest(url: presign.url)
    request.httpMethod = "PUT"
    presign.headers.forEach { key, value in request.setValue(value, forHTTPHeaderField: key) }
    let data = try Data(contentsOf: fileURL)
    _ = try await URLSession.shared.upload(for: request, from: data)
}
```

### Download Pre-sign
Similarly, call `POST /presign/download` with `{ "key": "<objectKey>" }`. The backend verifies ownership and returns a temporary URL.

## 6. Optional: Local SigV4 Signing (Advanced BYO Mode)

If users insist on never sharing keys with backend:
1. Store credentials in Keychain.
2. Implement a SigV4 signer (AWS has official Swift code: `AWSSignatureV4Signer`).
3. Generate PUT/GET requests entirely on device using the user’s keys and selected endpoint.
4. You can still hit `/entitlement` to check subscription status while skipping `/presign/upload`.

## 7. Handling Webhooks (Managed Mode)

The backend exposes:
- `POST /webhooks/appstore`
- `POST /webhooks/play`

Set these URLs in App Store Server Notifications and Google Real-Time Developer Notifications. The Swift client must supply mapping data (original transaction ID, app account token, purchase token) to the backend via a secure endpoint you control.

## 8. Testing Checklist for Frontend Team

- Authenticate with NIP-98 and hit `/health`, `/entitlement`.
- Perform upload presign → S3 PUT cycle using demo credentials.
- Confirm entitlement updates after injecting test webhook payloads (use Apple/Google sandbox tools).
- Validate fallback for BYO S3 when subscription is inactive.
- Consider additional error messaging for HTTP 402 (payment required) and 401 (auth).

This guide should enable the iOS client to support both user-supplied storage and the fully managed subscription experience backed by the Fastify/Prisma service. Reach out if you need sample Swift SigV4 helpers or StoreKit implementation details.
