import crypto from "node:crypto";
import type { Context, Hono, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { FC } from "hono/jsx";
import { APP_CSS } from "./styles.js";

export interface AuthenticatedUser {
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleUserInfo {
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export interface AuthConfig {
  enabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: string;
  allowedEmails: Set<string>;
  publicBaseUrl?: string;
  /** Optional dependency injection hook for unit tests */
  exchangeCodeForUser?: (params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) => Promise<GoogleUserInfo>;
}

interface SessionCookiePayload {
  email: string;
  name: string;
  picture?: string;
  exp: number;
}

interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  returnTo: string;
  exp: number;
}

export const SESSION_COOKIE_NAME = "provtrace_session";
const OAUTH_STATE_COOKIE_NAME = "provtrace_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes

export function parseAllowedEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"))
  );
}

export function loadAuthConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): AuthConfig {
  const googleClientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const explicitEnabled = env.AUTH_ENABLED === "true";
  const enabled = explicitEnabled || googleClientId.length > 0;

  if (!enabled) {
    return {
      enabled: false,
      googleClientId: "",
      googleClientSecret: "",
      sessionSecret: "",
      allowedEmails: new Set(),
    };
  }

  const googleClientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const sessionSecret = (env.SESSION_SECRET ?? "").trim();
  const allowedEmails = parseAllowedEmails(env.ALLOWED_GOOGLE_EMAILS);
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || undefined;

  const missing: string[] = [];
  if (!googleClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!googleClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (sessionSecret.length < 16) missing.push("SESSION_SECRET (min 16 chars)");
  if (allowedEmails.size === 0) missing.push("ALLOWED_GOOGLE_EMAILS");

  if (missing.length > 0) {
    throw new Error(
      `Google OAuth authentication is enabled, but required environment variables are missing or invalid: ${missing.join(", ")}`
    );
  }

  return {
    enabled: true,
    googleClientId,
    googleClientSecret,
    sessionSecret,
    allowedEmails,
    publicBaseUrl,
  };
}

export function signPayload(payload: object, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySignedPayload<T extends { exp: number }>(
  token: string | undefined,
  secret: string
): T | null {
  if (!token || !secret) return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx !== token.lastIndexOf(".")) return null;

  const encoded = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    if (typeof parsed.exp !== "number" || Date.now() >= parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizeReturnTo(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.startsWith("/auth/")) return "/";
  return raw;
}

function getRequestOrigin(c: Context, config: AuthConfig): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const reqUrl = new URL(c.req.url);
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || reqUrl.protocol.replace(":", "");
  const host = forwardedHost || c.req.header("host") || reqUrl.host;
  return `${proto}://${host}`;
}

function isHttpsRequest(c: Context, config: AuthConfig): boolean {
  if (config.publicBaseUrl) return config.publicBaseUrl.startsWith("https://");
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(c.req.url).protocol === "https:";
}

async function defaultExchangeCodeForUser(
  config: AuthConfig,
  params: { code: string; codeVerifier: string; redirectUri: string }
): Promise<GoogleUserInfo> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error("Google token response did not include an access_token");
  }

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    const errText = await userRes.text();
    throw new Error(`Google userinfo request failed (${userRes.status}): ${errText}`);
  }

  return (await userRes.json()) as GoogleUserInfo;
}

const AuthLayout: FC<{ title: string; children: unknown }> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>{title} — ProvTrace</title>
      <style dangerouslySetInnerHTML={{ __html: APP_CSS }} />
    </head>
    <body>
      <main
        style="min-block-size: 100vh; display: grid; place-items: center; padding: 1.5rem;"
      >
        <section
          class="panel"
          style="inline-size: min(100%, 440px); padding: 1.75rem; display: flex; flex-direction: column; gap: 1rem;"
        >
          {children}
        </section>
      </main>
    </body>
  </html>
);

const GoogleMark: FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.58-5.15 3.58-8.85z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.63H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.37l3.99-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l3.99 3.09c.95-2.85 3.6-4.95 6.73-4.95z"
    />
  </svg>
);

const SignInPage: FC<{ returnTo: string; errorMessage?: string }> = ({
  returnTo,
  errorMessage,
}) => (
  <AuthLayout title="Sign In">
    <div>
      <h1 class="app-title" style="font-size: 1.4rem;">
        ProvTrace · Provenance Tracer
      </h1>
      <p class="app-subtitle" style="margin-block-start: 0.35rem;">
        W3C PROV software &amp; audit traceability preview. Access is limited to pre-screened
        reviewers signed in with an approved Google account.
      </p>
    </div>

    {errorMessage ? (
      <div
        role="alert"
        style="padding: 0.65rem 0.85rem; border-radius: 0.45rem; background: var(--err-bg); color: var(--err-fg); font-size: 0.86rem;"
      >
        {errorMessage}
      </div>
    ) : null}

    <a
      href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
      class="btn primary"
      style="display: inline-flex; align-items: safe center; justify-content: center; gap: 0.6rem; padding: 0.65rem 1rem; font-size: 0.95rem; text-decoration: none;"
    >
      <GoogleMark />
      <span>Sign in with Google</span>
    </a>

    <p style="margin: 0; font-size: 0.78rem; color: var(--text-muted);">
      Need access? Contact the preview organizer to add your Google account email to the reviewer
      allowlist.
    </p>
  </AuthLayout>
);

const AccessDeniedPage: FC<{ email: string }> = ({ email }) => (
  <AuthLayout title="Access Restricted">
    <div>
      <span class="badge high" style="margin-block-end: 0.5rem;">
        Not on Reviewer Allowlist
      </span>
      <h1 class="app-title" style="font-size: 1.35rem;">
        Access Restricted
      </h1>
      <p class="app-subtitle" style="margin-block-start: 0.35rem;">
        You signed in as <code>{email}</code>, which is not currently on the screened reviewer
        allowlist for this ProvTrace preview.
      </p>
    </div>

    <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
      <a href="/auth/login" class="btn primary" style="text-decoration: none;">
        Try a Different Google Account
      </a>
    </div>
  </AuthLayout>
);

export function getAuthenticatedUser(c: Context, config: AuthConfig): AuthenticatedUser | null {
  if (!config.enabled) return null;
  const cookieVal = getCookie(c, SESSION_COOKIE_NAME);
  const payload = verifySignedPayload<SessionCookiePayload>(cookieVal, config.sessionSecret);
  if (!payload) return null;
  if (!config.allowedEmails.has(payload.email.toLowerCase())) return null;
  return {
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}

export function registerAuthRoutes(app: Hono, config: AuthConfig) {
  if (!config.enabled) return;

  app.get("/auth/signin", (c) => {
    const returnTo = sanitizeReturnTo(c.req.query("returnTo"));
    const error = c.req.query("error");
    const errorMessage =
      error === "state"
        ? "Your sign-in session expired or was invalid. Please try again."
        : error === "oauth"
          ? "Google sign-in could not be completed. Please try again."
          : error === "unverified"
            ? "Your Google account email must be verified to access this preview."
            : undefined;
    return c.html(`<!DOCTYPE html>${(<SignInPage returnTo={returnTo} errorMessage={errorMessage} />).toString()}`);
  });

  app.get("/auth/login", (c) => {
    const returnTo = sanitizeReturnTo(c.req.query("returnTo"));
    const state = crypto.randomBytes(24).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    const statePayload: OAuthStatePayload = {
      state,
      codeVerifier,
      returnTo,
      exp: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
    };

    setCookie(c, OAUTH_STATE_COOKIE_NAME, signPayload(statePayload, config.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttpsRequest(c, config),
      path: "/",
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });

    const redirectUri = `${getRequestOrigin(c, config)}/auth/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", config.googleClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("prompt", "select_account");

    return c.redirect(authUrl.toString(), 302);
  });

  app.get("/auth/callback", async (c) => {
    const oauthError = c.req.query("error");
    if (oauthError) {
      deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: "/" });
      return c.redirect("/auth/signin?error=oauth", 302);
    }

    const code = c.req.query("code");
    const stateParam = c.req.query("state");
    const stateCookie = getCookie(c, OAUTH_STATE_COOKIE_NAME);
    deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: "/" });

    const savedState = verifySignedPayload<OAuthStatePayload>(stateCookie, config.sessionSecret);
    if (!code || !stateParam || !savedState || savedState.state !== stateParam) {
      return c.redirect("/auth/signin?error=state", 302);
    }

    try {
      const redirectUri = `${getRequestOrigin(c, config)}/auth/callback`;
      const exchangeFn =
        config.exchangeCodeForUser ??
        ((params) => defaultExchangeCodeForUser(config, params));
      const userInfo = await exchangeFn({
        code,
        codeVerifier: savedState.codeVerifier,
        redirectUri,
      });

      if (!userInfo.email || userInfo.email_verified !== true) {
        return c.redirect("/auth/signin?error=unverified", 302);
      }

      const normalizedEmail = userInfo.email.trim().toLowerCase();
      if (!config.allowedEmails.has(normalizedEmail)) {
        deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
        return c.html(
          `<!DOCTYPE html>${(<AccessDeniedPage email={normalizedEmail} />).toString()}`,
          403
        );
      }

      const sessionPayload: SessionCookiePayload = {
        email: normalizedEmail,
        name: userInfo.name?.trim() || normalizedEmail,
        picture: userInfo.picture,
        exp: Date.now() + SESSION_TTL_SECONDS * 1000,
      };

      setCookie(c, SESSION_COOKIE_NAME, signPayload(sessionPayload, config.sessionSecret), {
        httpOnly: true,
        sameSite: "Lax",
        secure: isHttpsRequest(c, config),
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });

      return c.redirect(sanitizeReturnTo(savedState.returnTo), 302);
    } catch {
      return c.redirect("/auth/signin?error=oauth", 302);
    }
  });

  const handleLogout = (c: Context) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.redirect("/auth/signin", 302);
  };
  app.post("/auth/logout", handleLogout);
  app.get("/auth/logout", handleLogout);
}

export function createAuthMiddleware(config: AuthConfig) {
  return async (c: Context, next: Next) => {
    if (!config.enabled) {
      await next();
      return;
    }

    const reqPath = c.req.path;
    if (reqPath === "/healthz" || reqPath.startsWith("/auth/")) {
      await next();
      return;
    }

    const user = getAuthenticatedUser(c, config);
    if (!user) {
      if (reqPath.startsWith("/api/")) {
        return c.json({ error: "Authentication required" }, 401);
      }
      const reqUrl = new URL(c.req.url);
      const returnTo = sanitizeReturnTo(`${reqUrl.pathname}${reqUrl.search}`);
      return c.redirect(`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`, 302);
    }

    await next();
  };
}
