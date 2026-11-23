import type { NetworkRecorder, RecordedRequest } from "testplane/unstable";

type NetworkHeader = RecordedRequest["headers"][number];

// Match HTML Reporter's default network header masking in lib/secret-config-filter.ts.
const SENSITIVE_FIELDS = /token|secret|password|passwd|apikey|accesskey|privatekey/;
const SENSITIVE_HEADERS = /^(authorization|proxyauthorization|cookie|setcookie)$|csrf|xsrf|session/;
const AUTH_CREDENTIAL = /^(?:Basic|Bearer)[ \t]+[a-z0-9._~+/-]+=*$/i;
const JWT = /^eyJ[\w-]+\.(?:[\w-]+\.[\w-]*|[\w-]*\.[\w-]+\.[\w-]+\.[\w-]+)$/;

function maskHeader(header: NetworkHeader): NetworkHeader {
    const name = header.name
        .replace(/~1/g, "/")
        .replace(/~0/g, "~")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();
    const value = header.value.trim();
    if (
        SENSITIVE_FIELDS.test(name) ||
        SENSITIVE_HEADERS.test(name) ||
        value.startsWith("AQAD") ||
        value.startsWith("y1_") ||
        AUTH_CREDENTIAL.test(value) ||
        JWT.test(value)
    ) {
        return { ...header, value: `${header.value.slice(0, 5)}...` };
    }
    return header;
}

export function getLiveNetworkSnapshot(recorder: Pick<NetworkRecorder, "snapshot">): RecordedRequest[] {
    return recorder.snapshot().map(request => ({
        ...request,
        headers: request.headers.map(maskHeader),
        response: request.response && {
            ...request.response,
            headers: request.response.headers.map(maskHeader),
        },
    }));
}
