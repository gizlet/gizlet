"""Drive the public launcher binary and the real shell on a controlling PTY."""

import errno
import os
import pty
import re
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
        self.child_pids = set()

    def send(self, data):
        os.write(self.fd, data)

    def expect(self, text):
        return self.expect_match(re.compile(re.escape(text)))

    def expect_match(self, pattern):
        deadline = time.monotonic() + 5
        while True:
            match = pattern.search(self.pending)
            if match:
                self.pending = self.pending[match.end():]
                return match
            chunk = self.read(deadline)
            if chunk is None:
                raise AssertionError(f"timed out waiting for {pattern.pattern!r}: {self.transcript!r}")
            if not chunk:
                raise EOFError(f"PTY closed: {self.transcript!r}")

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
            for child in session.child_pids:
                try:
                    os.kill(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            os.kill(session.pid, signal.SIGKILL)
            os.waitpid(session.pid, 0)


def track_shell(session):
    session.send(b"printf 'INNER-PID:%s\\n' \"$$\"\n")
    shell_pid = int(session.expect_match(re.compile(rb"\r\nINNER-PID:(\d+)\r\n"))[1])
    session.child_pids.add(shell_pid)
    session.expect(SHELL_PROMPT)
    return shell_pid


def expect_reaped(session, shell_pid):
    try:
        os.kill(shell_pid, 0)
    except ProcessLookupError:
        session.child_pids.remove(shell_pid)
    else:
        raise AssertionError("inner shell was not reaped")


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
        home_modes = termios.tcgetattr(session.fd)

        session.send(b"terminal\n")
        session.expect(SHELL_PROMPT)
        shell_pid = track_shell(session)
        session.send(b"stty -echo; kill -STOP $$\n")
        session.expect(b"Terminal closed after its shell was suspended.")
        session.expect(HOME_PROMPT)
        expect_reaped(session, shell_pid)
        assert termios.tcgetattr(session.fd) == home_modes
        session.send(b"quit\n")
        session.finish()
        print(session.transcript.decode(errors="replace"), end="")


def foreground_group(pid):
    result = subprocess.check_output(["/bin/ps", "-p", str(pid), "-o", "tpgid="])
    return int(result)


def wait_for_command(outer_pid, shell_group):
    deadline = time.monotonic() + 5
    while foreground_group(outer_pid) == shell_group:
        assert time.monotonic() < deadline, "foreground command did not take the tty"
        time.sleep(0.02)


def check_nested_job_control(executable, busybox):
    with launch("/bin/bash", "--noprofile", "--norc", "-i") as session:
        session.expect(SHELL_PROMPT)
        session.send(b"PS1='outer> '\n")
        outer_prompt = b"\r\nouter> "
        session.expect(outer_prompt)
        outer_modes = termios.tcgetattr(session.fd)
        session.send(f"PS1='gizlet-shell> ' {shlex.quote(executable)}\n".encode())
        session.expect(HOME_PROMPT)
        home_modes = termios.tcgetattr(session.fd)
        home_group = foreground_group(session.pid)
        assert home_group != session.pid
        session.child_pids.add(home_group)

        session.send(b"terminal\n")
        session.expect(SHELL_PROMPT)
        shell_pid = track_shell(session)
        assert foreground_group(session.pid) == shell_pid

        session.send(b"/bin/sleep 30\n")
        wait_for_command(session.pid, shell_pid)
        session.send(b"\x1a")  # Ctrl-Z stops sleep and returns to the inner shell.
        session.expect(b"Stopped")
        session.expect(SHELL_PROMPT)
        assert foreground_group(session.pid) == shell_pid
        session.send(b"fg\n")
        wait_for_command(session.pid, shell_pid)
        session.send(b"\x03")  # Ctrl-C interrupts the resumed sleep.
        session.expect(SHELL_PROMPT)
        assert foreground_group(session.pid) == shell_pid

        stop = b"kill -STOP $$" if busybox else b"suspend"
        session.send(b"stty -echo -icanon; saved_modes=$(stty -g); " + stop + b"\n")
        session.expect(b"Stopped")
        session.expect(outer_prompt)
        assert foreground_group(session.pid) == session.pid
        assert termios.tcgetattr(session.fd) == outer_modes
        session.send(b"fg\n")
        session.expect(SHELL_PROMPT)
        assert foreground_group(session.pid) == shell_pid
        session.send(b"test \"$(stty -g)\" = \"$saved_modes\" && printf '%s%s\\n' SHELL_MODES_ OK\n")
        session.expect(b"SHELL_MODES_OK\r\n")
        session.expect(SHELL_PROMPT)
        session.send(b"stty tostop; kill -KILL $$\n")
        session.expect(b"Terminal ended on signal 9.")
        session.expect(HOME_PROMPT)
        assert foreground_group(session.pid) == home_group
        assert termios.tcgetattr(session.fd) == home_modes
        expect_reaped(session, shell_pid)

        session.send(b"quit\n")
        session.expect(outer_prompt)
        session.child_pids.remove(home_group)
        session.send(b"exit 0\n")
        session.finish()
        print("Nested job control passed. Shell resumed with fg and restored its modes.")


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
    check_nested_job_control(program, busybox)
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
