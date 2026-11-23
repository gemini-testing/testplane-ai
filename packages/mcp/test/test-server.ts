import { launchServer } from "./simple-http-server.js";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import type { AddressInfo } from "net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PlaygroundServer {
    private server: http.Server | null = null;
    private readonly playgroundPath: string;

    constructor(private readonly port = 0) {
        this.playgroundPath = path.join(__dirname, "playground");
    }

    async start(): Promise<string> {
        this.server = await launchServer(this.port, this.playgroundPath);
        const { port } = this.server.address() as AddressInfo;
        return `http://localhost:${port}`;
    }

    async stop(): Promise<void> {
        return new Promise(resolve => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
