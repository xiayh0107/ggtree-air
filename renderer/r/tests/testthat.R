#!/usr/bin/env Rscript

script_arg <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])
renderer_dir <- dirname(dirname(normalizePath(script_arg, mustWork = TRUE)))
options(ggtree.air.renderer_dir = renderer_dir)
for (module in sort(list.files(file.path(renderer_dir, "R"), pattern = "[.]R$", full.names = TRUE))) {
  sys.source(module, envir = .GlobalEnv)
}
if (!requireNamespace("testthat", quietly = TRUE)) stop("testthat is required", call. = FALSE)
testthat::test_dir(file.path(renderer_dir, "tests", "testthat"), reporter = "summary",
                   stop_on_failure = TRUE)
