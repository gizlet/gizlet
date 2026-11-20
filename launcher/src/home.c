#include "h2_gizlet_home.h"

#include "h2_trie.h"

#define TERMINAL_ENTRY "terminal"
#define QUIT_ENTRY "quit"

static const h2_gizlet_home_action_t terminal = H2_GIZLET_HOME_TERMINAL;
static const h2_gizlet_home_action_t quit = H2_GIZLET_HOME_QUIT;

static h2_pal_result_t select_action(const void* user,
                                     const h2_trie_match_t* match,
                                     void* response) {
  (void)match;
  *(h2_gizlet_home_action_t*)response = *(const h2_gizlet_home_action_t*)user;
  return H2_PAL_OK;
}

static const h2_trie_route_t routes[] = {
    {TERMINAL_ENTRY, H2_TRIE_ROUTE_EXACT, select_action, &terminal},
    {QUIT_ENTRY, H2_TRIE_ROUTE_EXACT, select_action, &quit},
};

h2_gizlet_home_action_t h2_gizlet_home_select(const char* selection) {
  if (selection[0] == '\0') {
    return H2_GIZLET_HOME_NONE;
  }
  h2_trie_t registry;
  h2_trie_node_t nodes[1 + H2_TRIE_LITERAL_NODE_COUNT(TERMINAL_ENTRY) +
                       H2_TRIE_LITERAL_NODE_COUNT(QUIT_ENTRY)];
  if (h2_trie_build(&registry, nodes, sizeof(nodes) / sizeof(nodes[0]), routes,
                    sizeof(routes) / sizeof(routes[0])) != H2_PAL_OK) {
    return H2_GIZLET_HOME_ERROR;
  }

  h2_gizlet_home_action_t action = H2_GIZLET_HOME_UNKNOWN;
  h2_pal_result_t result = h2_trie_handle(&registry, selection, &action);
  return result == H2_PAL_OK || result == H2_PAL_ERR_NOT_FOUND
             ? action
             : H2_GIZLET_HOME_ERROR;
}
