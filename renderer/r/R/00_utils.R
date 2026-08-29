# Shared helpers for the isolated R rendering worker.

`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0L || (length(x) == 1L && is.na(x))) y else x
}

renderer_assert_packages <- function(packages, purpose = "rendering") {
  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) > 0L) {
    stop("Missing R package(s) for ", purpose, ": ", paste(missing, collapse = ", "),
         call. = FALSE)
  }
  invisible(TRUE)
}

ggtree_air_iso_time <- function(time = Sys.time()) {
  format(time, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
}

ggtree_air_write_json <- function(value, path, pretty = TRUE) {
  renderer_assert_packages("jsonlite", "JSON output")
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  json <- jsonlite::toJSON(value, auto_unbox = TRUE, null = "null", na = "null",
                           dataframe = "rows", pretty = pretty, digits = NA)
  writeLines(enc2utf8(json), path, useBytes = TRUE)
  invisible(path)
}

ggtree_air_md5 <- function(path) {
  if (!file.exists(path)) return(NULL)
  unname(as.character(tools::md5sum(path)))
}
