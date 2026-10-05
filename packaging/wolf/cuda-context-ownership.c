/* gst-wayland-display 016b4fc wraps a context twice when ensure_element_context
 * re-enters set_context through Wolf's NEED_CONTEXT handler. The inner wrapper
 * owns the returned reference; the outer wrapper needs its own before dropping.
 * Apply only to Wolf's injected context, not a context created by the compositor.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ponytail: Wolf has one shared CUDA context; use a set if it adds per-GPU contexts. */
static _Atomic(void *) wolf_context;

static void *next_symbol(const char *name)
{
    void *symbol = dlsym(RTLD_NEXT, name);
    if (!symbol) {
        fprintf(stderr, "Wolf CUDA ownership: missing symbol %s\n", name);
        abort();
    }
    return symbol;
}

void *gst_context_new_cuda_context(void *context)
{
    void *(*next)(void *) = next_symbol("gst_context_new_cuda_context");
    atomic_store(&wolf_context, context);
    return next(context);
}

static int affected_compositor(void *element)
{
    const char *(*type_name)(void *) = next_symbol("g_type_name_from_instance");
    if (strcmp(type_name(element), "GstWaylandDisplaySrc") != 0)
        return 0;
    void *(*get_factory)(void *) = next_symbol("gst_element_get_factory");
    void *(*get_plugin)(void *) = next_symbol("gst_plugin_feature_get_plugin");
    const char *(*get_version)(void *) = next_symbol("gst_plugin_get_version");
    void (*object_unref)(void *) = next_symbol("gst_object_unref");
    void *plugin = get_plugin(get_factory(element));
    if (!plugin)
        return 0;
    int affected = strcmp(get_version(plugin), "0.4.0-016b4fc") == 0;
    object_unref(plugin);
    return affected;
}

int gst_cuda_ensure_element_context(void *element, int device_id, void **context)
{
    int (*next)(void *, int, void **) = next_symbol("gst_cuda_ensure_element_context");
    void *(*object_ref)(void *) = next_symbol("gst_object_ref");
    void *before = *context;
    int result = next(element, device_id, context);
    if (result && !before && *context && *context == atomic_load(&wolf_context)
            && affected_compositor(element)) {
        object_ref(*context);
    }
    return result;
}
