#ifndef H2_GIZLET_HOME_H
#define H2_GIZLET_HOME_H

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  H2_GIZLET_HOME_NONE,
  H2_GIZLET_HOME_TERMINAL,
  H2_GIZLET_HOME_QUIT,
  H2_GIZLET_HOME_UNKNOWN,
  H2_GIZLET_HOME_ERROR,
} h2_gizlet_home_action_t;

// Resolves a NUL-terminated selection into the app action for the host to run.
h2_gizlet_home_action_t h2_gizlet_home_select(const char* selection);

#ifdef __cplusplus
}
#endif

#endif
