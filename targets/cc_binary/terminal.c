#define _POSIX_C_SOURCE 200809L

#include "terminal.h"

#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

extern char** environ;

static bool restore_terminal(const struct termios* saved) {
  // An interactive shell can take foreground ownership for job control. After
  // an abnormal exit we may have to reclaim it while still in the background.
  sigset_t blocked;
  sigset_t previous;
  sigemptyset(&blocked);
  sigaddset(&blocked, SIGTTOU);
  if (sigprocmask(SIG_BLOCK, &blocked, &previous) == -1) {
    perror("Terminal: block SIGTTOU");
    return false;
  }

  bool restored = true;
  if (tcgetpgrp(STDIN_FILENO) != getpgrp() &&
      tcsetpgrp(STDIN_FILENO, getpgrp()) == -1) {
    perror("Terminal: restore foreground group");
    restored = false;
  }
  if (tcsetattr(STDIN_FILENO, TCSANOW, saved) == -1) {
    perror("Terminal: restore terminal settings");
    restored = false;
  }
  if (sigprocmask(SIG_SETMASK, &previous, NULL) == -1) {
    perror("Terminal: restore signal mask");
    restored = false;
  }
  return restored;
}

bool gizlet_terminal_run(const char* executable) {
  struct termios saved;
  if (tcgetattr(STDIN_FILENO, &saved) == -1) {
    perror("Terminal: read terminal settings");
    return false;
  }

#ifdef __linux__
  char* const argv[] = {"busybox", "sh", "-i", NULL};
#else
  char* const argv[] = {"sh", "-i", NULL};
#endif
  puts("\nOpening Terminal. Type exit to return to Gizlet.");
  if (fflush(stdout) == EOF) {
    perror("Terminal: write message");
    return false;
  }
  // The child inherits the tty. The launcher's caught INT and QUIT signals
  // return to their default dispositions on exec.
  pid_t child;
  int error = posix_spawn(&child, executable, NULL, NULL, argv, environ);
  if (error != 0) {
    fprintf(stderr, "Terminal: cannot launch %s: %s\n", executable,
            strerror(error));
#ifdef __linux__
    if (error == ENOENT) {
      fputs(
          "Install BusyBox at /bin/busybox or pass --busybox with its "
          "absolute path.\n",
          stderr);
    }
#endif
    return true;
  }

  int status;
  pid_t waited;
  do {
    waited = waitpid(child, &status, 0);
  } while (waited == -1 && errno == EINTR);

  if (waited == -1) {
    perror("Terminal: wait for shell");
  }
  if (!restore_terminal(&saved) || waited == -1) {
    return false;
  }
  if (WIFSIGNALED(status)) {
    fprintf(stderr, "Terminal ended on signal %d.\n", WTERMSIG(status));
  } else if (WIFEXITED(status) && WEXITSTATUS(status) != 0) {
    fprintf(stderr, "Terminal exited with status %d.\n", WEXITSTATUS(status));
  }
  return true;
}
