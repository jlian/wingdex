import argparse
import os
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self.byte_range = None
        requested = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not requested or not os.path.isfile(path):
            return super().send_head()
        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        size = os.fstat(source.fileno()).st_size
        match = re.fullmatch(r"bytes=(\d{0,19})-(\d{0,19})", requested)
        valid = match is not None and any(match.groups()) and size > 0
        if valid:
            first, last = match.groups()
            start = int(first) if first else max(0, size - int(last))
            end = min(size - 1, int(last)) if first and last else size - 1
            valid = start <= end and start < size
        if not valid:
            source.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        self.byte_range = (start, end)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        return source

    def copyfile(self, source, outputfile):
        try:
            self.copy_range(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            # Browsers cancel an in-flight range when seeking or closing a video.
            pass

    def copy_range(self, source, outputfile):
        if self.byte_range is None:
            return super().copyfile(source, outputfile)
        start, end = self.byte_range
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            data = source.read(min(65536, remaining))
            if not data:
                self.log_error("Video file ended before the requested range")
                break
            outputfile.write(data)
            remaining -= len(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    handler = partial(PreviewHandler, directory=os.path.abspath(args.directory))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Preview server: http://127.0.0.1:{args.port}/preview-pair.html", flush=True)
    server.serve_forever()
