"""Fixed SSH bridge. Secrets stay on the server and are never returned."""
import base64
import http.client
import json
import os
import re
import sys

MAX_INPUT = 16 * 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024
MAX_IMAGE = 8 * 1024 * 1024
MAX_IMAGE_OUTPUT = ((MAX_IMAGE + 2) // 3) * 4 + 1024


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError("input limit")
    request = json.loads(raw)
    method = request["method"]
    path = request["path"]
    if method not in ("GET", "POST", "PUT", "DELETE"):
        raise ValueError("method")
    if (not (path.startswith("/v1/") or path == "/healthz") or len(path) > 2048
            or any(ord(c) < 33 or ord(c) > 126 for c in path)
            or "#" in path or "\\" in path):
        raise ValueError("path")
    headers = {}
    for name, value in request["headers"]:
        if name.lower() not in ("content-type", "x-file-name"):
            raise ValueError("header")
        if len(value) > 1024 or any(ord(c) < 32 or ord(c) > 126 for c in value):
            raise ValueError("header")
        headers[name.lower()] = value
    payload = request.get("body")
    if headers.get("content-type", "").startswith("image/"):
        payload = base64.b64decode(payload["base64"], validate=True)
    elif payload is not None:
        payload = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"
    with open(os.path.expanduser("~/.config/codevo-runner/runner-token"), "r") as token_file:
        token = token_file.read(4097).strip()
    if not token or len(token) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise ValueError("authentication")
    headers["authorization"] = "Bearer " + token
    connection = http.client.HTTPConnection("127.0.0.1", 4318, timeout=20)
    try:
        expected_id = request.get("expectedRunnerId")
        if expected_id is not None:
            if not isinstance(expected_id, str) or not expected_id or len(expected_id) > 128:
                raise ValueError("identity")
            headers["x-codevo-runner-id"] = expected_id
        if expected_id is not None and path != "/v1/runner":
            connection.request("GET", "/v1/runner", headers={
                "authorization": headers["authorization"],
                "x-codevo-runner-id": expected_id,
            })
            identity_response = connection.getresponse()
            identity_body = identity_response.read(65537)
            if identity_response.status == 409:
                print('{"bridgeError":"Runner identity changed. Reconnect the server before continuing."}')
                return
            if identity_response.status != 200 or len(identity_body) > 65536:
                raise ValueError("identity")
            identity = json.loads(identity_body)
            if identity.get("protocolVersion") != 1 or identity.get("runnerId") != expected_id:
                print('{"bridgeError":"Runner identity changed. Reconnect the server before continuing."}')
                return
        connection.request(method, path, body=payload, headers=headers)
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            print(json.dumps({"bridgeError": "Runner request failed (HTTP %d)." % response.status}))
            return
        image_content = method == "GET" and re.fullmatch(
            r"/v1/attachments/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/content", path)
        artifact_content = method == "GET" and re.fullmatch(
            r"/v1/tasks/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/artifacts/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/content", path)
        binary_content = image_content or artifact_content
        read_limit = MAX_IMAGE if binary_content else MAX_OUTPUT
        output_limit = MAX_IMAGE_OUTPUT if binary_content else MAX_OUTPUT
        result = response.read(read_limit + 1)
        if len(result) > read_limit:
            raise ValueError("output limit")
        if binary_content:
            media_type = response.getheader("Content-Type")
            allowed = ("image/png", "image/jpeg", "image/webp", "text/html", "text/html; charset=utf-8") if artifact_content else ("image/png", "image/jpeg")
            if media_type not in allowed:
                raise ValueError("media type")
            media_type = media_type.split(";")[0]
            if media_type == "text/html":
                if len(result) > 2 * 1024 * 1024:
                    raise ValueError("HTML limit")
                result.decode("utf-8", errors="strict")
            if not result:
                raise ValueError("empty image")
            decoded = {"base64": base64.b64encode(result).decode("ascii"), "mediaType": media_type}
        else:
            decoded = json.loads(result) if result else None
        output = json.dumps({"result": decoded}, separators=(",", ":"))
        if len(output.encode("utf-8")) > output_limit:
            raise ValueError("output limit")
        print(output)
    finally:
        connection.close()


try:
    main()
except Exception:
    print('{"bridgeError":"Unable to contact the runner. Check its service and authentication."}')
    sys.exit(1)
