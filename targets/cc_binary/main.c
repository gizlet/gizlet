#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "h2_gizlet_home.h"
#include "terminal.h"

#ifdef __linux__
static const char* const default_shell = "/bin/busybox";
static const char* const terminal_label = "Terminal (BusyBox)";
#else
static const char* const default_shell = "/bin/sh";
static const char* const terminal_label = "Terminal (system shell)";
#endif

typedef enum {
  INPUT_LINE,
  INPUT_CLOSED,
  INPUT_INTERRUPTED,
  INPUT_INVALID,
  INPUT_ERROR,
} input_result_t;

static void interrupt_input(int signal_number) { (void)signal_number; }

static input_result_t read_selection(char* buffer, size_t capacity) {
  size_t length = 0;
  bool invalid = false;
  // Read only through the newline. The shell will read the same fd next.
  for (;;) {
    char byte;
    ssize_t count = read(STDIN_FILENO, &byte, 1);
    if (count == 0) {
      return INPUT_CLOSED;
    }
    if (count == -1) {
      return errno == EINTR ? INPUT_INTERRUPTED : INPUT_ERROR;
    }
    if (byte == '\n') {
      buffer[length] = '\0';
      return invalid ? INPUT_INVALID : INPUT_LINE;
    }
    if (byte == '\0' || length == capacity - 1) {
      invalid = true;
    } else {
      buffer[length++] = byte;
    }
  }
}

static void usage(FILE* output, const char* program) {
#ifdef __linux__
  fprintf(output, "Usage: %s [--busybox /absolute/path]\n", program);
#else
  fprintf(output, "Usage: %s\n", program);
#endif
}

int main(int argc, char* argv[]) {
  const char* shell = default_shell;
  if (argc == 2 && strcmp(argv[1], "--help") == 0) {
    usage(stdout, argv[0]);
    return EXIT_SUCCESS;
  }
  if (argc != 1) {
#ifdef __linux__
    if (argc == 3 && strcmp(argv[1], "--busybox") == 0 && argv[2][0] == '/') {
      shell = argv[2];
    } else {
      usage(stderr, argv[0]);
      return EXIT_FAILURE;
    }
#else
    usage(stderr, argv[0]);
    return EXIT_FAILURE;
#endif
  }
  if (tcgetpgrp(STDIN_FILENO) != getpgrp()) {
    fputs("Gizlet needs a foreground terminal.\n", stderr);
    return EXIT_FAILURE;
  }

  // Keep Ctrl-C and Ctrl-\ from killing Gizlet while a shell uses the tty.
  struct sigaction interrupt = {.sa_handler = interrupt_input};
  sigemptyset(&interrupt.sa_mask);
  if (sigaction(SIGINT, &interrupt, NULL) == -1 ||
      sigaction(SIGQUIT, &interrupt, NULL) == -1) {
    perror("Gizlet: configure terminal signals");
    return EXIT_FAILURE;
  }

  for (;;) {
    printf("\nGizlet Home\n  terminal  %s\n  quit      Exit Gizlet\ngizlet> ",
           terminal_label);
    if (fflush(stdout) == EOF) {
      perror("Gizlet: write menu");
      return EXIT_FAILURE;
    }
    char selection[64];
    input_result_t result = read_selection(selection, sizeof(selection));
    switch (result) {
      case INPUT_CLOSED:
        return EXIT_SUCCESS;
      case INPUT_INTERRUPTED:
        continue;
      case INPUT_ERROR:
        perror("Gizlet: read selection");
        return EXIT_FAILURE;
      case INPUT_INVALID:
        puts("Unknown selection. Enter terminal or quit.");
        continue;
      case INPUT_LINE:
        break;
    }
    switch (h2_gizlet_home_select(selection)) {
      case H2_GIZLET_HOME_TERMINAL:
        if (!gizlet_terminal_run(shell)) {
          return EXIT_FAILURE;
        }
        break;
      case H2_GIZLET_HOME_QUIT:
        return EXIT_SUCCESS;
      case H2_GIZLET_HOME_UNKNOWN:
        puts("Unknown selection. Enter terminal or quit.");
        break;
      case H2_GIZLET_HOME_ERROR:
        fputs("Gizlet could not resolve the Home selection.\n", stderr);
        return EXIT_FAILURE;
      case H2_GIZLET_HOME_NONE:
        break;
    }
  }
}
