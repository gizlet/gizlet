"""Drive the public launcher binary and the real shell on a controlling PTY."""

import errno
import os
import pty
import select
import shlex
import signal
import subprocess
import sys
import termios
import time
from contextlib import contextmanager

HOME_PROMPT = b"gizlet> "
SHELL_PROMPT = b"gizlet-shell> "


class Session:
    def __init__(self, pid, fd):
        self.pid = pid
        self.fd = fd
        self.pending = b""
        self.transcript = b""

    def send(self, data):
        os.write(self.fd, data)

    def expect(self, text):
        deadline = time.monotonic() + 5
        while text not in self.pending:
            chunk = self.read(deadline)
            if chunk is None:
                raise AssertionError(f"timed out waiting for {text!r}: {self.transcript!r}")
            if not chunk:
                raise EOFError(f"PTY closed: {self.transcript!r}")
        self.pending = self.pending.split(text, 1)[1]

    def read(self, deadline):
        if not select.select([self.fd], [], [], max(0, deadline - time.monotonic()))[0]:
            return None
        try:
            data = os.read(self.fd, 4096)
        except OSError as error:
            if error.errno != errno.EIO:  # Linux PTY EOF
                raise
            data = b""
        self.pending += data
        self.transcript += data
        return data

    def finish(self):
        deadline = time.monotonic() + 5
        while True:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.pid = None
                assert status == 0, (status, self.transcript)
                return
            if time.monotonic() >= deadline:
                raise AssertionError(f"launcher did not exit: {self.transcript!r}")
            # Darwin can wait for the master to drain echoed output at exit.
            if self.read(time.monotonic() + 0.01) == b"":
                time.sleep(0.01)


@contextmanager
def launch(executable, *arguments):
    env = {**os.environ, "TERM": "dumb", "PS1": SHELL_PROMPT.decode()}
    for name in ("ENV", "BASH_ENV", "PROMPT_COMMAND"):
        env.pop(name, None)
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(executable, [executable, *arguments], env)
    session = Session(pid, fd)
    try:
        yield session
    finally:
        os.close(fd)
        if session.pid is not None:
            os.kill(session.pid, signal.SIGKILL)
            os.waitpid(session.pid, 0)


def check_shell(executable, busybox=None):
    with launch(executable) as session:
        session.expect(b"Terminal (BusyBox)" if busybox else b"Terminal (system shell)")
        session.expect(HOME_PROMPT)
        for line in (b"terminal; echo unexpected", b"terminal\0", b"x" * 100 + b"terminal"):
            session.send(line + b"\n")
            session.expect(b"Unknown selection")
            session.expect(HOME_PROMPT)

        session.send(b"terminal\n")
        session.expect(SHELL_PROMPT)
        command = ""
        if busybox:
            # Compare the running shell itself, not an applet found on PATH.
            command = f"test /proc/$$/exe -ef {shlex.quote(busybox)} && "
        session.send((command + "printf '%s\\n' GIZLET_SHELL_OK\n").encode())
        session.expect(b"\r\nGIZLET_SHELL_OK\r\n")
        session.expect(SHELL_PROMPT)
        session.send(b"exit\n")
        session.expect(HOME_PROMPT)

        session.send(b"terminal\n")
        session.expect(SHELL_PROMPT)
        session.send(b"\x03")  # Ctrl-C at the interactive shell prompt
        session.expect(SHELL_PROMPT)
        session.send(b"stty -echo; exit 7\n")
        session.expect(b"Terminal exited with status 7.")
        session.expect(HOME_PROMPT)
        assert termios.tcgetattr(session.fd)[3] & termios.ECHO

        session.send(b"terminal\n")
        session.expect(SHELL_PROMPT)
        session.send(b"kill -KILL $$\n")
        session.expect(b"Terminal ended on signal 9.")
        session.expect(HOME_PROMPT)
        session.send(b"quit\n")
        session.finish()
        print(session.transcript.decode(errors="replace"), end="")


def check_launch_error(executable):
    missing = os.path.join(os.environ["TEST_TMPDIR"], "missing-busybox")
    with launch(executable, "--busybox", missing) as session:
        session.expect(HOME_PROMPT)
        session.send(b"terminal\n")
        session.expect(b"Terminal: cannot launch")
        session.expect(HOME_PROMPT)
        session.send(b"\x04")  # Ctrl-D on the home prompt
        session.finish()
        print("Missing absolute BusyBox path returned to Gizlet Home.")

    result = subprocess.run(
        [executable, "--busybox", "relative-path"], capture_output=True, check=False
    )
    assert result.returncode != 0 and b"Usage:" in result.stderr, result


if __name__ == "__main__":
    program = os.path.abspath(sys.argv[1])
    result = subprocess.run([program], stdin=subprocess.DEVNULL, capture_output=True)
    assert result.returncode != 0 and b"needs a foreground terminal" in result.stderr
    busybox = "/bin/busybox" if sys.platform.startswith("linux") else None
    check_shell(program, busybox)
    if busybox:
        with launch(program, "--busybox", busybox) as session:
            session.expect(HOME_PROMPT)
            session.send(b"terminal\n")
            session.expect(SHELL_PROMPT)
            session.send(b"exit\n")
            session.expect(HOME_PROMPT)
            session.send(b"quit\n")
            session.finish()
        check_launch_error(program)
