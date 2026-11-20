#ifndef GIZLET_TERMINAL_H
#define GIZLET_TERMINAL_H

#include <stdbool.h>

// The caller must own the controlling terminal. Returns false if the terminal
// cannot be recovered. Launch and child failures are displayed and return true.
bool gizlet_terminal_run(const char* executable);

#endif
