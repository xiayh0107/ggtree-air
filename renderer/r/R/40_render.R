# Render ggtree plots atomically to PNG/PDF files.

#' Generate all tree plots.
generate_all_plots <- function(result, output_dir = "results",
                               width = 10, height = 8, dpi = 300,
                               format = c("pdf", "png")) {
  if (!requireNamespace("ggplot2", quietly = TRUE)) {
    stop("Package `ggplot2` is required to render plots.", call. = FALSE)
  }
  format <- unique(tolower(as.character(format)))
  unsupported <- setdiff(format, c("pdf", "png", "svg"))
  if (length(format) == 0L || length(unsupported) > 0L) {
    stop("format must contain only `pdf`, `png`, and/or `svg`; got: ",
         paste(format, collapse = ", "), call. = FALSE)
  }
  dimensions <- c(width = width, height = height, dpi = dpi)
  if (any(!is.finite(dimensions)) || any(dimensions <= 0)) {
    stop("width, height, and dpi must be positive finite numbers.", call. = FALSE)
  }
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  output_dir <- normalizePath(output_dir, mustWork = TRUE)

  written <- character()
  write_plot <- function(plot, tag) {
    for (extension in format) {
      destination <- file.path(output_dir, paste0(tag, ".", extension))
      temporary <- tempfile(pattern = paste0(".", tag, "-"), tmpdir = output_dir,
                            fileext = paste0(".", extension))
      on.exit(unlink(temporary), add = TRUE)
      withCallingHandlers(
        ggplot2::ggsave(
          filename = temporary,
          plot = plot,
          device = extension,
          width = width,
          height = height,
          dpi = dpi,
          units = "in",
          bg = "white",
          limitsize = FALSE
        ),
        warning = function(warning) {
          # ggtree 4.0 + development ggplot2 can probe an optional `subgroup`
          # column while drawing circular labels. It is harmless and upstream.
          if (grepl("Unknown or uninitialised column: `subgroup`", conditionMessage(warning),
                    fixed = TRUE)
              || grepl("attributes are not identical across measure variables",
                       conditionMessage(warning), fixed = TRUE)
              || grepl("The following aesthetics were dropped during statistical transformation",
                       conditionMessage(warning), fixed = TRUE)
              || grepl("Using `size` aesthetic for lines was deprecated",
                       conditionMessage(warning), fixed = TRUE)) {
            invokeRestart("muffleWarning")
          }
        }
      )
      if (!file.exists(temporary) || file.info(temporary)$size <= 0L) {
        stop("Renderer produced an empty file for ", tag, ".", call. = FALSE)
      }
      if (file.exists(destination)) unlink(destination)
      if (!file.rename(temporary, destination)) {
        copied <- file.copy(temporary, destination, overwrite = TRUE)
        if (!copied) stop("Could not move rendered file to ", destination, call. = FALSE)
        unlink(temporary)
      }
      written <<- c(written, destination)
    }
  }

  for (lay in result$layout) {
    write_plot(result$base_plots[[lay]], paste0("tree_", lay))
  }
  for (lay in names(result$intent_plots)) {
    write_plot(result$intent_plots[[lay]], paste0("tree_", lay, "_intents"))
  }
  for (lay in names(result$annotated_plots)) {
    write_plot(result$annotated_plots[[lay]], paste0("tree_", lay, "_annotated"))
  }

  if (length(result$clade_nodes) > 0L) {
    plot <- result$base_plots[[result$layout[1]]]
    for (i in seq_along(result$clade_nodes)) {
      color <- if (length(result$branch_cols) > 0L) {
        unname(result$branch_cols[(i - 1L) %% length(result$branch_cols) + 1L])
      } else "grey30"
      plot <- plot + ggtree::geom_cladelabel(
        node = result$clade_nodes[i], label = result$clade_labels[i],
        color = color, offset = 0.03
      )
    }
    write_plot(plot, paste0("tree_", result$layout[1], "_cladelabeled"))
  }

  written <- unique(written)

  render_metadata <- list(
    schema_version = "1.0.0",
    created = if (exists("ggtree_air_iso_time", mode = "function")) {
      ggtree_air_iso_time()
    } else format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    width_in = unname(width),
    height_in = unname(height),
    dpi = unname(dpi),
    formats = as.list(format),
    artifacts = lapply(written, function(path) list(
      path = basename(path),
      format = tolower(tools::file_ext(path)),
      width_px = if (tolower(tools::file_ext(path)) == "png") as.integer(round(width * dpi)) else NULL,
      height_px = if (tolower(tools::file_ext(path)) == "png") as.integer(round(height * dpi)) else NULL,
      bytes = unname(file.info(path)$size),
      md5 = unname(as.character(tools::md5sum(path)))
    ))
  )
  metadata_path <- file.path(output_dir, "render_metadata.json")
  if (exists("ggtree_air_write_json", mode = "function")) {
    ggtree_air_write_json(render_metadata, metadata_path)
  } else {
    if (!requireNamespace("jsonlite", quietly = TRUE)) {
      stop("Package `jsonlite` is required for render metadata.", call. = FALSE)
    }
    writeLines(jsonlite::toJSON(render_metadata, auto_unbox = TRUE, null = "null",
                                na = "null", pretty = TRUE, digits = NA), metadata_path)
  }
  written <- c(written, metadata_path)

  cat("✓ All tree plots generated successfully\n")
  cat("  Wrote", length(written) - 1L, "figure file(s) + render metadata to", output_dir, "\n")
  invisible(written)
}
