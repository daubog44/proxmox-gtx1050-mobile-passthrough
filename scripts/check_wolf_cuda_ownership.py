#!/usr/bin/env python3
"""Run on Linux with a C compiler: python3 scripts/check_wolf_cuda_ownership.py."""
import os
import subprocess
import tempfile
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "packaging/wolf/cuda-context-ownership.c"
with tempfile.TemporaryDirectory() as directory:
    folder = Path(directory)
    backend = folder / "backend.c"
    backend.write_text('''
#include <assert.h>
#include <string.h>
static int owned, private;
static const char *version = "0.4.0-016b4fc";
void *gst_context_new_cuda_context(void *context) { return context; }
const char *g_type_name_from_instance(void *element) { return element; }
void *gst_element_get_factory(void *element) { return element; }
void *gst_plugin_feature_get_plugin(void *factory) { return factory; }
const char *gst_plugin_get_version(void *plugin) { return version; }
void gst_object_unref(void *object) { }
void *gst_object_ref(void *context) { ++*(int *)context; return context; }
int gst_cuda_ensure_element_context(void *element, int id, void **context) {
    if (id < 0) return 0;
    if (*context) return 1;
    *context = id ? &private : &owned;
    gst_object_ref(*context);
    return 1;
}
int check(void) {
    gst_context_new_cuda_context(&owned);
    for (int cycle = 0; cycle < 3; ++cycle) {
        void *context = 0;
        assert(gst_cuda_ensure_element_context("GstWaylandDisplaySrc", 0, &context));
        assert(owned == 2); /* one reference for each compositor wrapper */
        assert(gst_cuda_ensure_element_context("GstWaylandDisplaySrc", 0, &context));
        assert(owned == 2); /* existing slot: upstream already handles ownership */
        owned -= 2;
    }
    void *context = 0;
    assert(gst_cuda_ensure_element_context("GstCudaUpload", 0, &context));
    assert(owned == 1); /* other elements must not gain a reference */
    context = 0;
    assert(gst_cuda_ensure_element_context("GstWaylandDisplaySrc", 1, &context));
    assert(private == 1); /* context created without Wolf must not gain a reference */
    context = 0;
    assert(!gst_cuda_ensure_element_context("GstWaylandDisplaySrc", -1, &context));
    version = "0.5.0";
    context = 0;
    owned = 0;
    assert(gst_cuda_ensure_element_context("GstWaylandDisplaySrc", 0, &context));
    assert(owned == 1); /* never apply to a different compositor revision */
    return 0;
}
''')
    main = folder / "main.c"
    main.write_text("int check(void); int main(void) { return check(); }\n")
    def run(*args):
        subprocess.run(args, check=True)
    run("cc", "-shared", "-fPIC", "-Wall", "-Wextra", "-Wno-unused-parameter", str(backend), "-o", str(folder / "libbackend.so"))
    run("cc", "-shared", "-fPIC", "-std=c11", "-Wall", "-Wextra", "-Werror", str(source), "-ldl", "-o", str(folder / "ownership.so"))
    run("cc", str(main), "-L" + directory, "-lbackend", "-Wl,-rpath," + directory, "-o", str(folder / "check"))
    env = dict(os.environ, LD_PRELOAD=str(folder / "ownership.so"))
    subprocess.run([str(folder / "check")], env=env, check=True)
print("Wolf CUDA ownership: reconnessioni, contesti privati e altri elementi OK")
