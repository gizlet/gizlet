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

static bool set_terminal(pid_t group, const struct termios* modes) {
  // The inner shell may own the foreground when we switch the tty.
  sigset_t blocked;
  sigset_t previous;
  sigemptyset(&blocked);
  sigaddset(&blocked, SIGTTOU);
  if (sigprocmask(SIG_BLOCK, &blocked, &previous) == -1) {
    perror("Terminal: block SIGTTOU");
    return false;
  }

  bool ok = true;
  if (tcgetpgrp(STDIN_FILENO) != group &&
      tcsetpgrp(STDIN_FILENO, group) == -1) {
    perror("Terminal: set foreground group");
    ok = false;
  }
  if (tcsetattr(STDIN_FILENO, TCSANOW, modes) == -1) {
    perror("Terminal: set terminal modes");
    ok = false;
  }
  if (sigprocmask(SIG_SETMASK, &previous, NULL) == -1) {
    perror("Terminal: restore signal mask");
    ok = false;
  }
  return ok;
}

static pid_t wait_for_shell(pid_t child, int* status, int options) {
  pid_t waited;
  do {
    waited = waitpid(child, status, options);
  } while (waited == -1 && errno == EINTR);
  if (waited == -1) {
    perror("Terminal: wait for shell");
  }
  return waited;
}

typedef enum {
  SHELL_RESUMED,
  SHELL_NO_JOB_CONTROL,
  SHELL_RESUME_FAILED,
} shell_resume_result_t;

static shell_resume_result_t resume_stopped_shell(
    pid_t child, const struct termios* home_modes) {
  const pid_t home_group = getpgrp();
  const pid_t shell_group = getpgid(child);
  if (shell_group == -1) {
    perror("Terminal: read shell process group");
    return SHELL_RESUME_FAILED;
  }
  struct termios shell_modes;
  if (tcgetattr(STDIN_FILENO, &shell_modes) == -1) {
    perror("Terminal: read shell terminal modes");
    return SHELL_RESUME_FAILED;
  }
  if (!set_terminal(home_group, home_modes)) {
    return SHELL_RESUME_FAILED;
  }
  if (shell_group == home_group) {
    // The outer shell would continue both processes at once with fg.
    return SHELL_NO_JOB_CONTROL;
  }

  pid_t foreground;
  do {
    // A foreground launcher without a supervising job in the same session
    // has nobody to run fg for it. Return to Home in that case.
    const pid_t parent = getppid();
    const pid_t parent_group = getpgid(parent);
    if (parent_group == -1 || parent_group == home_group ||
        getsid(parent) != getsid(0)) {
      return SHELL_NO_JOB_CONTROL;
    }
    // Stop only Gizlet. The inner shell remains stopped until its tty and
    // modes are restored. If resumed in the background, stop again for fg.
    if (kill(getpid(), SIGSTOP) == -1) {
      perror("Terminal: suspend Gizlet");
      return SHELL_RESUME_FAILED;
    }
    foreground = tcgetpgrp(STDIN_FILENO);
    if (foreground == -1) {
      perror("Terminal: read foreground group on resume");
      return SHELL_RESUME_FAILED;
    }
  } while (foreground != home_group);

  if (!set_terminal(shell_group, &shell_modes)) {
    return SHELL_RESUME_FAILED;
  }
  if (kill(child, SIGCONT) == -1) {
    perror("Terminal: resume shell");
    return SHELL_RESUME_FAILED;
  }
  return SHELL_RESUMED;
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
  while (wait_for_shell(child, &status, WUNTRACED) == child) {
    if (WIFSTOPPED(status)) {
      shell_resume_result_t result = resume_stopped_shell(child, &saved);
      if (result == SHELL_RESUMED) {
        continue;
      }
      // Only the owned shell PID may be killed here. It could still share
      // Gizlet's process group if it stopped before initializing job control.
      if (kill(child, SIGKILL) == -1 && errno != ESRCH) {
        perror("Terminal: close stopped shell");
        set_terminal(getpgrp(), &saved);
        return false;
      }
      bool reaped = wait_for_shell(child, &status, 0) == child;
      bool restored = set_terminal(getpgrp(), &saved);
      if (result == SHELL_NO_JOB_CONTROL && reaped && restored) {
        fputs("Terminal closed after its shell was suspended.\n", stderr);
        return true;
      }
      return false;
    }
    if (!set_terminal(getpgrp(), &saved)) {
      return false;
    }
    if (WIFSIGNALED(status)) {
      fprintf(stderr, "Terminal ended on signal %d.\n", WTERMSIG(status));
    } else if (WIFEXITED(status) && WEXITSTATUS(status) != 0) {
      fprintf(stderr, "Terminal exited with status %d.\n", WEXITSTATUS(status));
    }
    return true;
  }
  set_terminal(getpgrp(), &saved);
  return false;
}
