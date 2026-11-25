#!/usr/bin/env python3
"""Run yt-dlp behind an HTTPS-intercepting proxy (NanoClaw/OneCLI and the like).

yt-dlp trusts the CA list from its bundled `certifi`, which doesn't include the proxy's CA,
and it ignores SSL_CERT_FILE, so every request fails with "self-signed certificate in
certificate chain". This points certifi at the proxy's bundle before yt-dlp starts. It keeps
certificate checking on; never use --no-check-certificates instead.

  YTDLP_CA_BUNDLE=/tmp/onecli-combined-ca.pem YTDLP_BIN=./yt-dlp \\
    python3 tools/yt-dlp-proxy.py --js-runtimes node -x --audio-format mp3 <url>

YTDLP_BIN: the yt-dlp zipapp (e.g. the nightly build) to import from; leave unset to use an
installed `yt_dlp` package.
"""
import os
import sys

CA = os.environ.get("YTDLP_CA_BUNDLE", "/tmp/onecli-combined-ca.pem")
if not os.path.isfile(CA):
    sys.exit(f"yt-dlp-proxy: CA bundle not found at {CA} - set YTDLP_CA_BUNDLE")

binary = os.environ.get("YTDLP_BIN")
if binary:
    sys.path.insert(0, os.path.abspath(binary))  # the zipapp is importable as a path entry

try:
    import certifi

    certifi.where = lambda: CA
except ImportError:
    pass  # no certifi: yt-dlp falls back to the system store
os.environ.setdefault("SSL_CERT_FILE", CA)

import yt_dlp  # noqa: E402

sys.exit(yt_dlp.main(sys.argv[1:]))
