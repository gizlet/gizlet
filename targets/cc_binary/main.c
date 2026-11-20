#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "h2_trie.h"
#include "terminal.h"

#ifdef __linux__
static const char* const default_shell = "/bin/busybox";
static const char* const terminal_label = "Terminal (BusyBox)";
#else
static const char* const default_shell = "/bin/sh";
static const char* const terminal_label = "Terminal (system shell)";
#endif

typedef struct {
  const char* shell;
  bool quit;
} home_t;

static h2_pal_result_t open_terminal(const void* user,
                                     const h2_trie_match_t* match,
                                     void* response) {
  (void)user;
  (void)match;
  const home_t* home = response;
  return gizlet_terminal_run(home->shell) ? H2_PAL_OK : H2_PAL_ERR_IO;
}

static h2_pal_result_t quit_home(const void* user, const h2_trie_match_t* match,
                                 void* response) {
  (void)user;
  (void)match;
  home_t* home = response;
  home->quit = true;
  return H2_PAL_OK;
}

static const h2_trie_route_t routes[] = {
    {.path = "terminal", .mode = H2_TRIE_ROUTE_EXACT, .handler = open_terminal},
    {.path = "quit", .mode = H2_TRIE_ROUTE_EXACT, .handler = quit_home},
};

static void interrupt_input(int signal_number) { (void)signal_number; }

static h2_pal_result_t read_selection(char* buffer, size_t capacity) {
  size_t length = 0;
  bool invalid = false;
  // Read only through the newline. The shell will read the same fd next.
  for (;;) {
    char byte;
    ssize_t count = read(STDIN_FILENO, &byte, 1);
    if (count == 0) {
      return H2_PAL_ERR_CLOSED;
    }
    if (count == -1) {
      return errno == EINTR ? H2_PAL_ERR_WOULD_BLOCK : H2_PAL_ERR_IO;
    }
    if (byte == '\n') {
      buffer[length] = '\0';
      return invalid ? H2_PAL_ERR_FORMAT : H2_PAL_OK;
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
  home_t home = {.shell = default_shell};
  if (argc == 2 && strcmp(argv[1], "--help") == 0) {
    usage(stdout, argv[0]);
    return EXIT_SUCCESS;
  }
  if (argc != 1) {
#ifdef __linux__
    if (argc == 3 && strcmp(argv[1], "--busybox") == 0 && argv[2][0] == '/') {
      home.shell = argv[2];
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

  h2_trie_t registry;
  h2_trie_node_t nodes[1 + H2_TRIE_LITERAL_NODE_COUNT("terminal") +
                       H2_TRIE_LITERAL_NODE_COUNT("quit")];
  if (h2_trie_build(&registry, nodes, sizeof(nodes) / sizeof(nodes[0]), routes,
                    sizeof(routes) / sizeof(routes[0])) != H2_PAL_OK) {
    fputs("Gizlet could not initialize its home menu.\n", stderr);
    return EXIT_FAILURE;
  }

  while (!home.quit) {
    printf("\nGizlet Home\n  terminal  %s\n  quit      Exit Gizlet\ngizlet> ",
           terminal_label);
    if (fflush(stdout) == EOF) {
      perror("Gizlet: write menu");
      return EXIT_FAILURE;
    }
    char selection[64];
    h2_pal_result_t result = read_selection(selection, sizeof(selection));
    if (result == H2_PAL_ERR_CLOSED) {
      return EXIT_SUCCESS;
    }
    if (result == H2_PAL_ERR_WOULD_BLOCK) {
      continue;
    }
    if (result == H2_PAL_ERR_IO) {
      perror("Gizlet: read selection");
      return EXIT_FAILURE;
    }
    if (result == H2_PAL_OK && selection[0] != '\0') {
      result = h2_trie_handle(&registry, selection, &home);
    }
    if (result == H2_PAL_ERR_FORMAT || result == H2_PAL_ERR_NOT_FOUND) {
      puts("Unknown selection. Enter terminal or quit.");
    } else if (result != H2_PAL_OK) {
      return EXIT_FAILURE;
    }
  }
  return EXIT_SUCCESS;
}
