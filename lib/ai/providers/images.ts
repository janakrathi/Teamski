// ==========================================
// IMAGE GENERATION - CLOUDFLARE WORKERS AI
// ==========================================
//
// FLUX.1 [schnell] on Cloudflare's Workers AI makes
// good images fast, on a genuinely free tier with no
// card. The workspace runs on a shared account (env
// CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN), but
// a person can bring their own account + token for
// their own daily limit - passed in here, falling
// back to the shared one when absent.
//
// The provider is a detail: swapping to another
// image API is this one file.
//

const MODEL =
  "@cf/black-forest-labs/flux-1-schnell";

const API = "https://api.cloudflare.com/client/v4";


// Whether the shared account can make images, so the
// rest of the app can decide without the details.

export function imageGenConfigured() {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_API_TOKEN
  );
}


export type GeneratedImage =
  | { bytes: Buffer; mime: string }
  | { error: string };


export async function generateImage(
  prompt: string,
  options?: {
    accountId?: string;
    token?: string;
    signal?: AbortSignal;
  }
): Promise<GeneratedImage> {
  const accountId =
    options?.accountId ||
    process.env.CLOUDFLARE_ACCOUNT_ID;

  const token =
    options?.token ||
    process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !token) {
    return { error: "no-key" };
  }

  try {
    const response = await fetch(
      `${API}/accounts/${accountId}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,

          // schnell is distilled for 1-4 steps; more
          // barely helps and just costs neurons, and
          // the free tier is 10k neurons a day at
          // ~9.6 per step. 4 is its quality end.
          steps: 4,
        }),
        signal: options?.signal,
      }
    );

    if (!response.ok) {
      const text = await response
        .text()
        .catch(() => "");

      console.log(
        `[image] cloudflare ${response.status}: ${text.slice(
          0,
          200
        )}`
      );

      return {
        error: `${response.status}${
          text ? `: ${text.slice(0, 200)}` : ""
        }`,
      };
    }

    const data = (await response.json()) as {
      result?: { image?: string };
      errors?: { message?: string }[];
    };

    const base64 = data.result?.image;

    if (
      typeof base64 === "string" &&
      base64.length > 0
    ) {
      return {
        bytes: Buffer.from(base64, "base64"),
        mime: "image/jpeg",
      };
    }

    return {
      error:
        data.errors?.[0]?.message ??
        "no image was returned",
    };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "the request failed",
    };
  }
}


// Confirm a person's own Cloudflare account id + token
// work for Workers AI, without running (and paying
// for) a generation. Null means they are good.

export async function verifyImageKey(
  accountId: string,
  token: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `${API}/accounts/${accountId}/ai/models/search?per_page=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      return "Cloudflare rejected that token. Check it has the Workers AI permission.";
    }

    if (response.status === 404) {
      return "That account ID was not found. Copy it from your Cloudflare dashboard URL.";
    }

    return response.ok
      ? null
      : `Cloudflare returned ${response.status}.`;
  } catch {
    return "Could not reach Cloudflare. Check the account ID and token.";
  }
}
