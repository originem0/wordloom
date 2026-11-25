/** Reads SSE without assuming HTTP chunks end at an event or UTF-8 boundary. */
export async function* readSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  const line = (value: string) => {
    if (value.startsWith("event:")) event = value.slice(6).trim();
    if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("Stream event too large");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const next = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (next) line(next);
        else {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        }
      }
      if (done) {
        if (buffer) line(buffer.replace(/\r$/, ""));
        if (data.length) yield { event, data: data.join("\n") };
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
