// ==========================================
// IMAGE GENERATION - CLOUDFLARE WORKERS AI
// ==========================================
//
// FLUX.2 [klein] on Cloudflare's Workers AI: a 2026
// Black Forest Labs model, much sharper than the older
// FLUX.1 [schnell], on the same genuinely free tier
// with no card - 10,000 "neurons" a day per account,
// about 95 images a day at 1024x1024 (26 neurons per
// 512px tile of output). If it fails, FLUX.1 [schnell]
// is tried, so an image still comes back.
//
// The workspace runs on a shared account (env
// CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN), but
// a person can bring their own account + token for
// their own daily limit - passed in here, falling
// back to the shared one when absent.
//
// The provider is a detail: swapping to another
// image API is this one file.
//

// Sharper, newer. Takes multipart form input.
const MODEL =
  "@cf/black-forest-labs/flux-2-klein-4b";

// The older, cheaper fallback. Takes JSON.
const FALLBACK_MODEL =
  "@cf/black-forest-labs/flux-1-schnell";

const SIZE = 1024;

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

  const url = (model: string) =>
    `${API}/accounts/${accountId}/ai/run/${model}`;

  // FLUX.2 [klein]: multipart form, steps fixed at 4.
  const form = new FormData();

  form.append("prompt", prompt);
  form.append("width", String(SIZE));
  form.append("height", String(SIZE));

  const best = await run(
    url(MODEL),
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: options?.signal },
    "flux-2-klein"
  );

  if (!("error" in best) || options?.signal?.aborted) {
    return best;
  }

  // FLUX.1 [schnell]: JSON. Distilled for 1-4 steps;
  // more barely helps and just costs neurons.
  const fallback = await run(
    url(FALLBACK_MODEL),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: options?.signal,
    },
    "flux-1-schnell"
  );

  // Report the newer model's reason if both failed:
  // it is the one that was meant to answer.
  return "error" in fallback ? best : fallback;
}


// The image type, from its first bytes - the models
// return JPEG or PNG without saying which.
export function imageMime(bytes: Buffer) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";

  return "image/jpeg";
}


async function run(
  url: string,
  init: RequestInit,
  label: string
): Promise<GeneratedImage> {
  try {
    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response
        .text()
        .catch(() => "");

      console.log(
        `[image] ${label} ${response.status}: ${text.slice(0, 200)}`
      );

      return {
        error: `${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }

    const data = (await response.json()) as {
      result?: { image?: string };
      image?: string;
      errors?: { message?: string }[];
    };

    const base64 = data.result?.image ?? data.image;

    if (typeof base64 === "string" && base64.length > 0) {
      const bytes = Buffer.from(base64, "base64");

      return { bytes, mime: imageMime(bytes) };
    }

    return {
      error: data.errors?.[0]?.message ?? "no image was returned",
    };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "the request failed",
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
