"""Boot the final card on QEMU virt and drive Gizlet Home over the guest UART."""

import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time


def boot(image, kernel):
    command = [
        "qemu-system-aarch64", "-machine", "virt", "-cpu", "cortex-a35", "-m", "512",
        "-display", "none", "-monitor", "none", "-serial", "stdio", "-nic", "none", "-no-reboot",
        "-kernel", str(kernel),
        "-append", "console=ttyAMA0 root=PARTUUID=36335030-02 rootfstype=squashfs rootwait ro",
        "-drive", f"if=none,id=os,format=raw,readonly=on,file={str(image).replace(',', ',,')}",
        "-device", "virtio-blk-device,drive=os",
    ]
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT) as guest, selectors.DefaultSelector() as serial:
        serial.register(guest.stdout, selectors.EVENT_READ)
        pending = bytearray()
        deadline = time.monotonic() + 90

        def expect(text):
            marker = text.encode()
            while marker not in pending:
                if not serial.select(max(0, deadline - time.monotonic())):
                    raise TimeoutError(f"waiting for {text!r}")
                chunk = os.read(guest.stdout.fileno(), 8192)
                if not chunk:
                    raise EOFError(f"guest exited before {text!r}")
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
                pending.extend(chunk)
            del pending[:pending.index(marker) + len(marker)]

        def enter(line):
            guest.stdin.write((line + "\n").encode())
            guest.stdin.flush()

        try:
            expect("Gizlet Home")
            expect("gizlet> ")
            enter("terminal")
            expect("Opening Terminal")
            expect("# ")
            enter("readlink /proc/$$/exe")
            expect("\r\n/bin/busybox\r\n")
            enter("cat /proc/mounts")
            expect(" / squashfs ro,")
            expect("# ")
            enter("exit")
            expect("Gizlet Home")
            expect("gizlet> ")
            enter("terminal")
            expect("Opening Terminal")
            expect("# ")
            enter("poweroff -f")
            expect("Power down")
            if guest.wait(timeout=10) != 0:
                raise RuntimeError("QEMU failed at shutdown")
        finally:
            if guest.poll() is None:
                guest.kill()
                guest.wait()


def main():
    image = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(dir=os.environ.get("TEST_TMPDIR")) as work:
        kernel = Path(work) / "Image"
        subprocess.run(["mcopy", "-i", f"{image}@@16777216", "::Image", str(kernel)], check=True)
        boot(image, kernel)


if __name__ == "__main__":
    main()
