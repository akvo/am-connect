#!/usr/bin/env python3
"""Minimal stand-in for a remote CKAN instance (an "ASEAN member state catalogue").

ckanext-harvest's CKAN harvester only needs two read-only API calls:

    GET /api/3/action/package_search?rows=100&start=0&sort=id+asc[&fq=...]
    GET /api/3/action/package_show?id=<id>          (not used by the harvester, kept for curl)
    GET /api/3/action/organization_show?id=<name>   (only with remote_orgs=create)

Datasets come from datasets.json next to this file; edit the file (add, change,
remove a dataset) and re-run the harvest to observe how CKAN synchronises.
No dependencies beyond the Python standard library.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("MOCK_DATA", os.path.join(HERE, "datasets.json"))


def load():
    with open(DATA) as fh:
        doc = json.load(fh)
    return doc["datasets"], doc.get("organizations", [])


class Handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        body = json.dumps(payload, indent=1).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlsplit(self.path)
        qs = {k: v[0] for k, v in parse_qs(url.query).items()}
        datasets, orgs = load()
        if url.path == "/api/3/action/package_search":
            start, rows = int(qs.get("start", 0)), int(qs.get("rows", 100))
            ordered = sorted(datasets, key=lambda d: d["id"])
            page = ordered[start:start + rows]
            return self._json({"success": True, "result": {"count": len(ordered), "results": page}})
        if url.path == "/api/3/action/package_show":
            for d in datasets:
                if qs.get("id") in (d["id"], d["name"]):
                    return self._json({"success": True, "result": d})
            return self._json({"success": False, "error": {"__type": "Not Found Error"}}, 404)
        if url.path == "/api/3/action/organization_show":
            for o in orgs:
                if qs.get("id") in (o["id"], o["name"]):
                    return self._json({"success": True, "result": o})
            return self._json({"success": False, "error": {"__type": "Not Found Error"}}, 404)
        if url.path in ("/", "/api/3/action/status_show"):
            return self._json({"success": True, "result": {"site_title": "Mock ASEAN member-state CKAN",
                                                           "ckan_version": "2.11", "datasets": len(datasets)}})
        return self._json({"success": False, "error": "unknown action"}, 404)

    def log_message(self, fmt, *args):  # keep container logs readable
        print("[mock-ckan]", fmt % args)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    print(f"[mock-ckan] serving {DATA} on :{port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
