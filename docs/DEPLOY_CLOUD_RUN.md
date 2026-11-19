# Deploying ProvTrace to Google Cloud Run (Screened Google Sign-In + Read-Only Demo)

This guide explains how to publish ProvTrace as a **read-only preview** on **Google Cloud Run** where access is restricted to pre-screened reviewers signed in with their Google accounts.

---

## 1. Create Google OAuth 2.0 Credentials

1. Open [Google Cloud Console → APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):
   - Choose **External** (so reviewers with personal `@gmail.com` or external Google Workspace accounts can sign in).
   - Fill in App Name (`ProvTrace Preview`), Support Email, and Developer Contact Email.
   - Scopes: `openid`, `email`, `profile`.
   - Under **Test users** (while in Testing mode), add the Google emails of your screened reviewers (or publish the consent screen to Production and rely on ProvTrace's `ALLOWED_GOOGLE_EMAILS` allowlist).
2. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `ProvTrace Cloud Run`.
   - **Authorized redirect URIs**:
     - For local Docker testing: `http://localhost:8080/auth/callback`
     - For Cloud Run (add after first deploy once you know your Cloud Run URL): `https://<your-cloud-run-service-url>/auth/callback`
3. Copy the **Client ID** (`GOOGLE_CLIENT_ID`) and **Client Secret** (`GOOGLE_CLIENT_SECRET`).

---

## 2. Generate a Session Signing Secret

ProvTrace uses stateless HMAC-SHA256 signed `HttpOnly` session cookies (`provtrace_session`) so sessions survive Cloud Run instance restarts and scale-to-zero transitions.

Generate a strong random `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Test the Container Locally

```bash
# Build the container image (compiles policies/policy.wasm and seeds data/provtrace.db)
docker build -t provtrace-ts .

# Run locally in read-only mode (without auth)
docker run --rm -p 8080:8080 provtrace-ts

# Or run locally with Google OAuth + allowlist enabled (copy .env.example to .env first)
docker run --rm -p 8080:8080 --env-file .env provtrace-ts
```

Visit `http://localhost:8080/healthz` to verify the container responds with `{"status":"ok","readOnly":true,...}`.

---

## 4. Deploy to Google Cloud Run

You can deploy directly from your GitHub repository in the **Google Cloud Console** (Cloud Run → **Deploy container** → **Continuously deploy from a repository** using the root `Dockerfile`), or via the `gcloud` CLI after validating flags with `gcloud help run deploy`.

Configure the following settings on your Cloud Run service:
- **Container port**: `8080`
- **Authentication (Cloud Run IAM)**: Allow unauthenticated invocations (ProvTrace's built-in Google OAuth middleware enforces sign-in and allowlist checks on all routes except `/healthz` and `/auth/*`).
- **Scaling**: Minimum instances `0` (in `READ_ONLY_MODE=true`, SSE is disabled so idle tabs do not block scale-to-zero).
- **Environment variables / Secrets** (prefer **Secret Manager** for `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET`):
  - `READ_ONLY_MODE=true`
  - `GOOGLE_CLIENT_ID=<your-oauth-client-id>`
  - `GOOGLE_CLIENT_SECRET=<your-oauth-client-secret>`
  - `SESSION_SECRET=<your-64-char-hex-secret>`
  - `ALLOWED_GOOGLE_EMAILS=you@gmail.com,reviewer1@example.com,reviewer2@example.com`
  - `PUBLIC_BASE_URL=https://<your-cloud-run-service-url>` (set once the service URL is assigned)

After deployment:
1. Copy the assigned Cloud Run URL (`https://...a.run.app`).
2. Add `https://<your-cloud-run-service-url>/auth/callback` to **Authorized redirect URIs** in your Google OAuth client.
3. Update `PUBLIC_BASE_URL` on the Cloud Run service to match the URL.

---

## 5. Managing Screened Reviewers

To add or revoke a reviewer, update the `ALLOWED_GOOGLE_EMAILS` environment variable on the Cloud Run service:
- **Adding an email** grants access on their next sign-in.
- **Removing an email** immediately revokes access on their next request (the middleware re-checks `ALLOWED_GOOGLE_EMAILS` on every request, even for existing cookies).
