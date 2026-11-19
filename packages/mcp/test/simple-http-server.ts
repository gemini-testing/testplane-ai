import http from "http";
import { AddressInfo } from "net";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import handler from "serve-handler";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function launchServer(port: number, rootDir = join(__dirname, "playground")): Promise<http.Server> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((request, response) => {
            if (request.url === "/network-fixture") {
                response.setHeader("Content-Type", "text/plain; charset=utf-8");
                response.setHeader("Set-Cookie", "fixture-cookie=fixture-value; Path=/");
                response.setHeader("X-Debug", "Bearer fixture-token");
                response.end("server-wiring-ok");
                return;
            }
            return handler(request, response, {
                public: rootDir,
            });
        });
        server.once("error", reject);
        server.once("listening", () => {
            const boundPort = (server.address() as AddressInfo).port;
            console.log(`Running at http://localhost:${boundPort}`);
            resolve(server);
        });

        server.listen(port);
    });
}
