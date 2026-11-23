import { SessionCloseTool, ToolKind } from "../types.js";
import { createSimpleResponse } from "../responses/index.js";

export const closeBrowserSchema = {};

const closeBrowserCb: SessionCloseTool<typeof closeBrowserSchema>["cb"] = async (_args, close) => {
    if (!close) {
        return createSimpleResponse("No active browser session to close");
    }

    console.error("Closing browser session...");
    try {
        await close();
        console.error("Browser session closed");
    } catch (error) {
        console.error("Error closing browser session:", error);
    }

    return createSimpleResponse("Browser session closed successfully");
};

export const closeBrowser: SessionCloseTool<typeof closeBrowserSchema> = {
    kind: ToolKind.SessionClose,
    name: "close-browser",
    description: "Close the current browser session",
    schema: closeBrowserSchema,
    cb: closeBrowserCb,
    cli: { section: "Session" },
};
