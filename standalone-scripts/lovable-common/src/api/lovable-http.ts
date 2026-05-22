import { LovableApiError } from "./lovable-api-error";

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const HEADER_AUTH = "Authorization";
const HEADER_CONTENT_TYPE = "Content-Type";
const HEADER_ACCEPT = "Accept";
const MIME_JSON = "application/json";
const BEARER_PREFIX = "Bearer ";
const EMPTY_JSON_BODY = "{}";

export type LovableHttpMethod = "GET" | "POST" | "PUT";

export interface LovableHttpRequest {
    method: LovableHttpMethod;
    endpoint: string;
    bearerToken: string;
    jsonBody?: object;
}

const isOk = (status: number): boolean => status >= HTTP_OK_MIN && status < HTTP_OK_MAX;

const buildHeaders = (bearerToken: string, hasBody: boolean): Headers => {
    const headers = new Headers();
    headers.set(HEADER_AUTH, BEARER_PREFIX + bearerToken);
    headers.set(HEADER_ACCEPT, MIME_JSON);

    if (hasBody) {
        headers.set(HEADER_CONTENT_TYPE, MIME_JSON);
    }

    return headers;
};

const buildInit = (request: LovableHttpRequest): RequestInit => {
    const hasBody = request.jsonBody !== undefined;
    const init: RequestInit = {
        method: request.method,
        headers: buildHeaders(request.bearerToken, hasBody),
        credentials: "include",
        mode: "cors",
    };

    if (hasBody) {
        init.body = JSON.stringify(request.jsonBody);
    }

    return init;
};

const readBodyOrThrow = async (response: Response, endpoint: string, method: string): Promise<string> => {
    const bodyText = await response.text();

    if (!isOk(response.status)) {
        throw new LovableApiError(`Lovable API ${response.status}`, response.status, endpoint, bodyText, method);
    }

    return bodyText;
};

export const lovableHttpJson = async (request: LovableHttpRequest): Promise<object> => {
    const response = await fetch(request.endpoint, buildInit(request));
    const bodyText = await readBodyOrThrow(response, request.endpoint, request.method);
    const safeText = bodyText.length === 0 ? EMPTY_JSON_BODY : bodyText;
    const parsed: object = JSON.parse(safeText);

    return parsed;
};
