import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";

import { tools, ToolKind, launchBrowserWithOptions, type BrowserOptions, type BrowserSession } from "@testplane/tools";

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { WdioBrowser } from "testplane";
import { NetworkRecorder } from "testplane/unstable";

interface PackageJson {
    name: string;
    version: string;
}

function createNoActiveBrowserResponse(toolName: string) {
    return {
        content: [
            {
                type: "text",
                text: `❌ No active browser session. Run "navigate" to auto-start one, or run "launch" before "${toolName}".`,
            },
        ],
        isError: true,
    };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson: PackageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

export interface ServerOptions {
    headless?: boolean;
}

export async function startServer(serverOptions: ServerOptions = {}): Promise<McpServer> {
    let browser: BrowserSession | null = null;
    let recorder: NetworkRecorder | undefined;
    let sessionQueue: Promise<unknown> = Promise.resolve();
    let isShuttingDown = false;

    function queueSessionChange<T>(change: () => Promise<T>): Promise<T> {
        const result = sessionQueue.then(change);
        sessionQueue = result.catch(() => undefined);
        return result;
    }

    async function setBrowser(nextBrowser: BrowserSession): Promise<void> {
        let nextRecorder: NetworkRecorder | undefined;
        try {
            const session = nextBrowser as WdioBrowser;
            if (await session.unstable_getCdp?.()) {
                nextRecorder = await NetworkRecorder.start(session, { maxBodySizeBytes: 10 * 1024 * 1024 });
            }
        } catch (error) {
            console.error("Could not start network recording:", error);
        }
        browser = nextBrowser;
        recorder = nextRecorder;
    }

    async function closeBrowser(): Promise<void> {
        const closingBrowser = browser;
        const closingRecorder = recorder;
        browser = null;
        recorder = undefined;

        await closingRecorder?.stop().catch(() => {});
        await closingBrowser?.deleteSession();
    }

    const defaultOptions: BrowserOptions = { headless: serverOptions.headless ?? false };
    let sessionOptions: BrowserOptions = { ...defaultOptions };

    const server = new McpServer({
        name: packageJson.name,
        version: packageJson.version,
    });

    /* eslint-disable @typescript-eslint/no-explicit-any */
    for (const tool of tools) {
        server.tool(
            tool.name,
            tool.description,
            tool.schema as unknown as ZodRawShape,
            async (args: any): Promise<any> => {
                if (isShuttingDown) {
                    throw new Error("MCP server is shutting down");
                }

                if (tool.kind === ToolKind.Standalone) {
                    return tool.cb(args);
                }

                if (tool.kind === ToolKind.Network) {
                    return tool.cb(args, recorder);
                }

                if (tool.kind === ToolKind.Action) {
                    const activeBrowser = await queueSessionChange(async () => {
                        if (!browser && tool.autoLaunchBrowser) {
                            await setBrowser(await launchBrowserWithOptions(defaultOptions));
                        }
                        return browser;
                    });

                    if (!activeBrowser) {
                        return createNoActiveBrowserResponse(tool.name);
                    }

                    return tool.cb(args, activeBrowser as never);
                }

                if (tool.kind === ToolKind.SessionOpen) {
                    return queueSessionChange(async () => {
                        const { browser: nextBrowser, options, response } = await tool.cb(args, sessionOptions);
                        if (!nextBrowser) {
                            return response;
                        }

                        await closeBrowser().catch(error => console.error("Error closing previous browser:", error));
                        await setBrowser(nextBrowser);
                        sessionOptions = options;
                        return response;
                    });
                }

                return queueSessionChange(() => tool.cb(args, browser ? closeBrowser : undefined));
            },
        );
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    console.error("Starting Testplane MCP server...");
    console.error("Name:", packageJson.name, "Version:", packageJson.version);

    const transport = new StdioServerTransport();

    try {
        await server.connect(transport);
        console.error("Testplane MCP server connected");

        const cleanup = () => {
            if (isShuttingDown) {
                return;
            }
            isShuttingDown = true;

            console.error("Shutting down server, cleaning up resources...");

            const cleanupTimeout = setTimeout(() => {
                console.error("Cleanup timeout reached, forcing exit");
                process.exit(1);
            }, 5000);

            queueSessionChange(async () => {
                if (browser) {
                    try {
                        await closeBrowser();
                        console.error("Browser session closed");
                    } catch (error) {
                        console.error("Error closing browser session:", error);
                    }
                }
            })
                .then(() => {
                    console.error("Cleanup completed");
                    clearTimeout(cleanupTimeout);
                    process.exit(0);
                })
                .catch(error => {
                    console.error("Error during cleanup:", error);
                    clearTimeout(cleanupTimeout);
                    process.exit(1);
                });
        };

        process.on("SIGINT", () => {
            console.error("Received SIGINT signal, shutting down...");
            cleanup();
        });

        process.on("SIGTERM", () => {
            console.error("Received SIGTERM signal, shutting down...");
            cleanup();
        });

        process.on("exit", code => {
            console.error(`Process exiting with code ${code}`);
        });

        return server;
    } catch (error) {
        console.error("Error connecting MCP server:", error);
        throw error;
    }
}
