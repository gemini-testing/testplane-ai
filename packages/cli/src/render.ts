import type { Response } from "./ipc/protocol.js";

function write(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(chunk, error => (error ? reject(error) : resolve()));
    });
}

export async function renderAndExit(response: Response): Promise<never> {
    if (response.kind === "error") {
        await write(process.stderr, response.message + "\n");
        process.exit(2);
    }

    const text = response.content
        .filter(c => c.type === "text")
        .map(c => c.text ?? "")
        .join("\n");

    await write(process.stdout, text.endsWith("\n") ? text : text + "\n");
    process.exit(response.isError ? 1 : 0);
}
