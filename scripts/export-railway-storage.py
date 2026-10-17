#!/usr/bin/env python3
"""Read-only S3 inventory/backup. Credentials stay in child-process environments.

Requires authenticated Railway CLI and AWS CLI. Output belongs in ignored data/.
Object filenames are SHA-256 hashes of their keys to prevent path traversal.
The manifest retains original keys and response metadata for a later import.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlparse


def run_json(command, environment=None, address_style="auto"):
    if command[0] == "aws":
        # Configure only this invocation, without changing the operator's AWS profile.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".config") as config:
            config.write("[default]\ns3 =\n    addressing_style = " + address_style + "\n")
            config.flush()
            scoped_env = dict(environment)
            scoped_env["AWS_CONFIG_FILE"] = config.name
            result = subprocess.run(command, env=scoped_env, capture_output=True, text=True)
    else:
        result = subprocess.run(command, env=environment, capture_output=True, text=True)
    if result.returncode:
        error = re.search(r"An error occurred \(([A-Za-z0-9_.-]+)\) when calling the ([A-Za-z0-9]+)", result.stderr)
        category = "/".join(error.groups()) if error else next((label for text, label in [
            ("Could not connect", "connection"), ("SSL validation failed", "TLS"),
            ("Unable to locate credentials", "credentials"), ("Unknown options", "CLI options"),
            ("Invalid endpoint", "endpoint"), ("Could not resolve", "DNS"),
        ] if text in result.stderr), "unclassified CLI error")
        raise RuntimeError(f"{command[0]} failed ({category}); no credentials or raw output were logged")
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--service", required=True, help="Railway presigner service ID")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--endpoint", help="Canonical base endpoint verified in Railway bucket settings")
    parser.add_argument("--address-style", choices=["auto", "virtual", "path"], default="auto")
    args = parser.parse_args()
    os.umask(0o077)
    root = args.output.resolve()
    if not root.is_relative_to((Path.cwd() / "data").resolve()):
        raise ValueError("Backup output must be inside the ignored local data/ directory")
    if root.exists():
        raise ValueError("Use a fresh output directory; existing backups are never overwritten")

    variables = run_json([
        "railway", "variables", "--json", "--project", args.project,
        "--environment", args.environment, "--service", args.service,
    ])
    endpoint = args.endpoint or variables["S3_ENDPOINT"]
    parsed = urlparse(endpoint)
    host = parsed.hostname or ""
    allowed_host = host in {"storage.railway.app", "t3.storageapi.dev"} or host.endswith(".storage.railway.app")
    if parsed.scheme != "https" or not allowed_host or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Expected the Railway bucket's HTTPS storage endpoint")
    credentials = [variables.get(name) for name in ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]]
    if not all(credentials):
        raise ValueError("Readable storage credentials are required")
    env = {key: value for key, value in os.environ.items() if not key.startswith("AWS_")}
    env.update({
        "AWS_ACCESS_KEY_ID": credentials[0], "AWS_SECRET_ACCESS_KEY": credentials[1],
        "AWS_DEFAULT_REGION": variables.get("S3_REGION") or "auto",
        "AWS_EC2_METADATA_DISABLED": "true", "AWS_PAGER": "",
        "AWS_CONFIG_FILE": os.devnull, "AWS_SHARED_CREDENTIALS_FILE": os.devnull,
    })
    bucket = variables["S3_BUCKET"]
    command = ["aws", "--endpoint-url", endpoint, "--output", "json", "s3api"]
    # AWS CLI auto-pagination combines every page (do not use --max-items).
    inventory = run_json(command + ["list-objects-v2", "--bucket", bucket], env, args.address_style).get("Contents", [])
    root.mkdir(parents=True)
    entries = []
    for item in inventory:
        entry = {"key": item["Key"], "bytes": item["Size"], "etag": item.get("ETag"), "lastModified": item.get("LastModified")}
        if args.download:
            filename = hashlib.sha256(item["Key"].encode("utf8")).hexdigest()
            target = root / filename
            metadata = run_json(command + ["get-object", "--bucket", bucket, "--key", item["Key"], str(target)], env, args.address_style)
            if target.stat().st_size != item["Size"] or metadata.get("ETag") != item.get("ETag"):
                raise RuntimeError("An object changed during backup; preserve this partial backup and retry in a fresh directory")
            with target.open("rb") as body:
                digest = hashlib.sha256()
                for chunk in iter(lambda: body.read(1024 * 1024), b""):
                    digest.update(chunk)
                checksum = digest.hexdigest()
            entry.update({"file": filename, "sha256": checksum, "metadata": metadata})
        entries.append(entry)
    if args.download:
        current = run_json(command + ["list-objects-v2", "--bucket", bucket], env, args.address_style).get("Contents", [])
        signature = lambda objects: sorted((o["Key"], o["Size"], o.get("ETag"), o.get("LastModified")) for o in objects)
        if signature(inventory) != signature(current):
            raise RuntimeError("Bucket changed during backup; preserve this partial backup and retry after freezing writes")
    manifest = {"bucket": bucket, "endpoint": endpoint, "completeDownload": args.download, "count": len(entries), "bytes": sum(e["bytes"] for e in entries), "objects": entries}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in ["completeDownload", "count", "bytes"]}))
    print("Manifest: " + str(root / "manifest.json"))


if __name__ == "__main__":
    main()
