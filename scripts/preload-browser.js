#!/usr/bin/env node

import { launchBrowserWithOptions } from "@testplane/tools";

async function preloadBrowser() {
    const browser = await launchBrowserWithOptions({ headless: true });

    await browser.deleteSession();
}

preloadBrowser();
