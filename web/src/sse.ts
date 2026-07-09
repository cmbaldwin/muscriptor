/** A failed `/transcribe` request. `userMessage`, when set, is a server-sent
 *  explanation safe to show the user (e.g. "could not decode audio file …"). */
export class TranscribeError extends Error {
  readonly userMessage?: string;
  readonly status?: number;
  constructor(message: string, opts: { userMessage?: string; status?: number } = {}) {
    super(message);
    this.name = "TranscribeError";
    this.userMessage = opts.userMessage;
    this.status = opts.status;
  }
}

/** Stream SSE `data:` JSON payloads from a POST upload of `file`. */
export async function* streamTranscribe(
  url: string,
  file: File,
  extra?: Record<string, string | string[]>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (Array.isArray(v)) {
        for (const item of v) form.append(k, item);
      } else {
        form.append(k, v);
      }
    }
  }
  const resp = await fetch(url, { method: "POST", body: form, signal });
  if (!resp.ok || !resp.body) {
    // FastAPI's HTTPException bodies are `{"detail": "..."}`. Pull the detail
    // out (when present) so the UI can show why the upload was rejected
    // instead of a bare status code.
    let detail: string | undefined;
    try {
      const body = await resp.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      // Non-JSON body (or network error reading it) — leave detail unset.
    }
    throw new TranscribeError(`server returned ${resp.status}`, {
      userMessage: detail,
      status: resp.status,
    });
  }
  const reader = resp.body
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          yield JSON.parse(line.slice(6));
        }
      }
    }
  }
}
